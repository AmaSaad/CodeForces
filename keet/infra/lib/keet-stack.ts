import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Keet Infrastructure Stack
 *
 * Architecture:
 *   Telegram → Lambda Function URL → Lambda → DynamoDB (single table)
 *                                           → OpenAI API (direct, no VPC)
 *                                           → Telegram API (direct, no VPC)
 *
 * No VPC. No RDS. No NAT. No connection pooling.
 * DynamoDB handles everything via single-table design with pre-computed aggregates.
 *
 * Cost at zero traffic: ~$1/mo (Secrets Manager only)
 * Cost at 1K msgs/day:  ~$2/mo
 * Scales to millions of messages without architecture changes.
 */
export class KeetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────
    // Secrets — bot token and LLM keys
    // ─────────────────────────────────────────────

    const telegramBotToken = new secretsmanager.Secret(this, 'TelegramBotToken', {
      secretName: 'keet/telegram-bot-token',
      description: 'Telegram Bot API token from BotFather',
    });

    const openaiApiKey = new secretsmanager.Secret(this, 'OpenAIApiKey', {
      secretName: 'keet/openai-api-key',
      description: 'OpenAI API key for transaction parsing',
    });

    // ─────────────────────────────────────────────
    // DynamoDB — single table for all data
    //
    // Single-table design with composite PK/SK:
    //   Businesses, contacts, items, transactions, balances,
    //   daily summaries, confirmations — all in one table.
    //
    // PAY_PER_REQUEST = $0 at rest, ~$1.25 per million writes.
    // Point-in-time recovery for financial data safety.
    // ─────────────────────────────────────────────

    const mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: 'keet',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true, // Financial data — never lose it
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep data on stack delete
    });

    // Dedup table — separate because it's high-churn with TTL
    const dedupTable = new dynamodb.Table(this, 'MessageDedup', {
      tableName: 'keet-message-dedup',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─────────────────────────────────────────────
    // Lambda — no VPC needed (DynamoDB is a public AWS service)
    // Direct internet access for OpenAI + Telegram APIs
    // ─────────────────────────────────────────────

    const webhookFn = new nodejs.NodejsFunction(this, 'WebhookHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/lambda/webhook.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        NODE_ENV: 'production',
        DYNAMODB_TABLE: mainTable.tableName,
        TELEGRAM_BOT_TOKEN_SECRET_ARN: telegramBotToken.secretArn,
        OPENAI_API_KEY_SECRET_ARN: openaiApiKey.secretArn,
        DEDUP_TABLE_NAME: dedupTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Lambda Function URL — free HTTPS endpoint, no API Gateway needed
    const functionUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Permissions
    mainTable.grantReadWriteData(webhookFn);
    dedupTable.grantReadWriteData(webhookFn);
    telegramBotToken.grantRead(webhookFn);
    openaiApiKey.grantRead(webhookFn);

    // ─────────────────────────────────────────────
    // Webhook registration — tells Telegram where to send updates
    // ─────────────────────────────────────────────

    const webhookSetupFn = new nodejs.NodejsFunction(this, 'WebhookSetupHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/lambda/setup-webhook.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TELEGRAM_BOT_TOKEN_SECRET_ARN: telegramBotToken.secretArn,
        WEBHOOK_URL: functionUrl.url,
      },
    });

    telegramBotToken.grantRead(webhookSetupFn);

    const webhookSetupProvider = new cr.Provider(this, 'WebhookSetupProvider', {
      onEventHandler: webhookSetupFn,
    });

    new cdk.CustomResource(this, 'SetTelegramWebhook', {
      serviceToken: webhookSetupProvider.serviceToken,
      properties: {
        webhookUrl: functionUrl.url,
      },
    });

    // ─────────────────────────────────────────────
    // Outputs
    // ─────────────────────────────────────────────

    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: functionUrl.url,
      description: 'Lambda Function URL for Telegram webhook',
    });

    new cdk.CfnOutput(this, 'MainTableName', {
      value: mainTable.tableName,
      description: 'DynamoDB main table name',
    });

    new cdk.CfnOutput(this, 'TelegramBotTokenSecretArn', {
      value: telegramBotToken.secretArn,
      description: 'Set this secret value to your BotFather token',
    });

    new cdk.CfnOutput(this, 'OpenAIApiKeySecretArn', {
      value: openaiApiKey.secretArn,
      description: 'Set this secret value to your OpenAI API key',
    });
  }
}
