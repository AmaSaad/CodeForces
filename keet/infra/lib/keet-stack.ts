import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Keet Infrastructure Stack
 *
 * Architecture:
 *   Telegram → Lambda Function URL → Lambda (in VPC) → RDS PostgreSQL via RDS Proxy
 *                                                    → DynamoDB (dedup)
 *                                                    → OpenAI API (via NAT Instance)
 *                                                    → Telegram API (via NAT Instance)
 *
 * Cost at zero traffic: ~$23/mo ($11 with RDS free tier)
 * Cost at 1K msgs/day:  ~$24/mo
 * Scales to millions of messages without architecture changes.
 */
export class KeetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────
    // VPC — minimal, 2 AZs, NAT Instance instead of NAT Gateway ($3/mo vs $32/mo)
    // ─────────────────────────────────────────────

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0, // We'll add a NAT Instance instead
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // NAT Instance — t4g.nano (~$3/mo) replaces NAT Gateway (~$32/mo)
    // Lambda in private subnet routes through this to reach OpenAI + Telegram APIs
    const natInstance = new ec2.Instance(this, 'NatInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      sourceDestCheck: false, // Required for NAT
    });

    // Configure the instance as a NAT
    natInstance.addUserData(
      'yum install iptables-services -y',
      'systemctl enable iptables',
      'systemctl start iptables',
      'echo 1 > /proc/sys/net/ipv4/ip_forward',
      'echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf',
      'iptables -t nat -A POSTROUTING -o ens5 -s 10.0.0.0/16 -j MASQUERADE',
      'service iptables save',
    );

    // Allow all traffic from VPC through NAT instance
    natInstance.connections.allowFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
      'Allow VPC traffic for NAT',
    );

    // Route private subnets through NAT instance
    for (const subnet of vpc.privateSubnets) {
      (subnet as ec2.Subnet).addRoute('NatRoute', {
        routerId: natInstance.instanceId,
        routerType: ec2.RouterType.INSTANCE,
        destinationCidrBlock: '0.0.0.0/0',
      });
    }

    // ─────────────────────────────────────────────
    // Secrets — bot token and LLM keys, stored securely
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
    // RDS PostgreSQL — db.t4g.micro (~$12/mo, free tier eligible)
    // Single-AZ for cost. Switch to Multi-AZ when revenue justifies it.
    // ─────────────────────────────────────────────

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Allow PostgreSQL access from Lambda and RDS Proxy',
      allowAllOutbound: false,
    });

    const dbInstance = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      databaseName: 'keet',
      credentials: rds.Credentials.fromGeneratedSecret('keet_admin', {
        secretName: 'keet/db-credentials',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100, // Auto-expand up to 100GB
      storageType: rds.StorageType.GP3,
      multiAz: false, // Single-AZ for cost savings. Flip when revenue justifies it.
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT, // Keep data on stack delete
      deletionProtection: false, // Set to true in production
    });

    // ─────────────────────────────────────────────
    // RDS Proxy — connection pooling for Lambda (~$7/mo)
    // Lambda creates a new connection per invocation without this.
    // Proxy pools them so RDS never gets overwhelmed.
    // ─────────────────────────────────────────────

    const proxy = new rds.DatabaseProxy(this, 'DbProxy', {
      proxyTarget: rds.ProxyTarget.fromInstance(dbInstance),
      secrets: [dbInstance.secret!],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      requireTLS: true,
      iamAuth: false, // Use secret-based auth through Proxy for simplicity
      dbProxyName: 'keet-proxy',
    });

    // Allow proxy to connect to RDS
    dbSecurityGroup.addIngressRule(
      dbSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow proxy/lambda to connect to RDS',
    );

    // ─────────────────────────────────────────────
    // DynamoDB — message dedup table (zero cost at rest)
    // Replaces Redis. Telegram can retry webhooks; this prevents double-processing.
    // ─────────────────────────────────────────────

    const dedupTable = new dynamodb.Table(this, 'MessageDedup', {
      tableName: 'keet-message-dedup',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─────────────────────────────────────────────
    // Lambda — the application, bundled with esbuild
    // ─────────────────────────────────────────────

    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Lambda security group',
      allowAllOutbound: true, // Needs internet for OpenAI + Telegram APIs
    });

    // Allow Lambda to connect to RDS Proxy
    dbSecurityGroup.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to RDS Proxy',
    );

    const webhookFn = new nodejs.NodejsFunction(this, 'WebhookHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/lambda/webhook.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: `postgresql://PROXY_AUTH@${proxy.endpoint}:5432/keet?sslmode=require`,
        DB_SECRET_ARN: dbInstance.secret!.secretArn,
        TELEGRAM_BOT_TOKEN_SECRET_ARN: telegramBotToken.secretArn,
        OPENAI_API_KEY_SECRET_ARN: openaiApiKey.secretArn,
        DEDUP_TABLE_NAME: dedupTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        // Exclude AWS SDK v3 — it's in the Lambda runtime already
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Lambda Function URL — free HTTPS endpoint, no API Gateway needed
    const functionUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Telegram sends to this URL directly
    });

    // Permissions
    dbInstance.secret!.grantRead(webhookFn);
    telegramBotToken.grantRead(webhookFn);
    openaiApiKey.grantRead(webhookFn);
    dedupTable.grantReadWriteData(webhookFn);

    // ─────────────────────────────────────────────
    // Migration runner — runs SQL migrations on deploy
    // ─────────────────────────────────────────────

    const migrationFn = new nodejs.NodejsFunction(this, 'MigrationHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/lambda/migrate.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      environment: {
        DB_SECRET_ARN: dbInstance.secret!.secretArn,
        DATABASE_HOST: proxy.endpoint,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
        // Include the migration SQL file
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] { return []; },
          afterBundling(_inputDir: string, outputDir: string): string[] {
            return [
              `mkdir -p ${outputDir}/migrations`,
              `cp ${path.join(__dirname, '../../src/db/migrations/001_initial.sql')} ${outputDir}/migrations/`,
            ];
          },
          beforeInstall(): string[] { return []; },
        },
      },
    });

    dbInstance.secret!.grantRead(migrationFn);

    // Run migrations on every deploy
    const migrationProvider = new cr.Provider(this, 'MigrationProvider', {
      onEventHandler: migrationFn,
    });

    new cdk.CustomResource(this, 'RunMigrations', {
      serviceToken: migrationProvider.serviceToken,
      properties: {
        // Change this value to force re-run migrations
        version: '001',
      },
    });

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

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
      description: 'RDS direct endpoint (for admin/migrations)',
    });

    new cdk.CfnOutput(this, 'DbProxyEndpoint', {
      value: proxy.endpoint,
      description: 'RDS Proxy endpoint (used by Lambda)',
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
