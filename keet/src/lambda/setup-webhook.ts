/**
 * CDK Custom Resource handler that registers the Telegram webhook URL.
 * Runs after deploy so Telegram knows where to send updates.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const smClient = new SecretsManagerClient({});

export async function handler(event: any): Promise<{ PhysicalResourceId: string }> {
  console.log('Webhook setup event:', event.RequestType);

  if (event.RequestType === 'Delete') {
    // Optionally remove the webhook on stack deletion
    return { PhysicalResourceId: event.PhysicalResourceId || 'webhook-setup' };
  }

  const webhookUrl = process.env.WEBHOOK_URL || event.ResourceProperties.webhookUrl;
  if (!webhookUrl) {
    throw new Error('WEBHOOK_URL not set');
  }

  // Load bot token from Secrets Manager
  const tokenArn = process.env.TELEGRAM_BOT_TOKEN_SECRET_ARN!;
  const cmd = new GetSecretValueCommand({ SecretId: tokenArn });
  const result = await smClient.send(cmd);
  const botToken = result.SecretString;

  if (!botToken) {
    console.warn('Bot token secret is empty — set it in Secrets Manager and redeploy');
    return { PhysicalResourceId: 'webhook-setup' };
  }

  // Register webhook with Telegram
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      }),
    },
  );

  const body = (await response.json()) as { ok: boolean; description?: string };
  console.log('setWebhook response:', JSON.stringify(body));

  if (!body.ok) {
    throw new Error(`Failed to set webhook: ${JSON.stringify(body)}`);
  }

  return { PhysicalResourceId: 'webhook-setup' };
}
