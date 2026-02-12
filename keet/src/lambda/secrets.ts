/**
 * Loads secrets from AWS Secrets Manager into process.env.
 * Called once during Lambda cold start, then cached for warm invocations.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

async function getSecret(arn: string): Promise<string> {
  const cmd = new GetSecretValueCommand({ SecretId: arn });
  const result = await client.send(cmd);
  return result.SecretString || '';
}

export async function loadSecrets(): Promise<void> {
  // Load Telegram bot token
  const botTokenArn = process.env.TELEGRAM_BOT_TOKEN_SECRET_ARN;
  if (botTokenArn && !process.env.TELEGRAM_BOT_TOKEN) {
    process.env.TELEGRAM_BOT_TOKEN = await getSecret(botTokenArn);
  }

  // Load OpenAI API key
  const openaiArn = process.env.OPENAI_API_KEY_SECRET_ARN;
  if (openaiArn && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = await getSecret(openaiArn);
  }

  // No DB credentials needed — DynamoDB uses IAM auth automatically
}
