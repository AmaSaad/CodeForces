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

  // Load DB credentials and build DATABASE_URL
  const dbSecretArn = process.env.DB_SECRET_ARN;
  if (dbSecretArn && process.env.DATABASE_URL?.includes('PROXY_AUTH')) {
    const raw = await getSecret(dbSecretArn);
    const creds = JSON.parse(raw);
    const host = process.env.DATABASE_URL.match(/@(.+):5432/)?.[1] || 'localhost';
    process.env.DATABASE_URL =
      `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${host}:5432/keet?sslmode=require`;
  }
}
