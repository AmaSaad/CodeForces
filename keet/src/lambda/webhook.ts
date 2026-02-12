/**
 * Lambda handler for Telegram webhook.
 *
 * Flow:
 * 1. Telegram POSTs an Update JSON to the Function URL
 * 2. We dedup via DynamoDB (Telegram retries on timeout)
 * 3. We process the message via KeetAgent
 * 4. We send the response via Telegram Bot API
 * 5. We return 200 to Telegram
 *
 * The agent, DB, and parser code is identical to local dev —
 * only the entry point and config differ.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { loadSecrets } from './secrets.js';
import { checkDedup, markProcessed } from '../utils/dedup.js';
import { KeetAgent } from '../engine/agent.js';
import type { IncomingMessage } from '../types.js';

let agent: KeetAgent | null = null;
let secretsLoaded = false;

async function init(): Promise<void> {
  if (!secretsLoaded) {
    await loadSecrets();
    secretsLoaded = true;
  }
  if (!agent) {
    agent = new KeetAgent();
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    await init();

    if (!event.body) {
      return { statusCode: 200, body: 'ok' };
    }

    const update = JSON.parse(event.body);

    // Extract the message or callback query
    const message = update.message;
    const callbackQuery = update.callback_query;

    if (callbackQuery) {
      return handleCallback(callbackQuery);
    }

    if (!message?.text && !message?.contact) {
      return { statusCode: 200, body: 'ok' };
    }

    // Dedup — Telegram retries webhooks if we're slow
    const dedupKey = `telegram#${message.from.id}#${message.message_id}`;
    const isDuplicate = await checkDedup(dedupKey);
    if (isDuplicate) {
      return { statusCode: 200, body: 'ok' };
    }

    // Build incoming message
    const incoming: IncomingMessage = {
      channel: 'telegram',
      channel_user_id: message.from.id.toString(),
      phone_number: message.contact?.phone_number,
      message_text: message.text || '/start',
      message_id: message.message_id.toString(),
      timestamp: new Date(message.date * 1000),
    };

    // Process
    const response = await agent!.processMessage(incoming);

    // Send response via Telegram API
    await sendTelegramMessage(message.chat.id, response.message_text, response.inline_keyboard);

    // Mark as processed after successful handling
    await markProcessed(dedupKey);

    return { statusCode: 200, body: 'ok' };
  } catch (error) {
    console.error('Webhook handler error:', error);
    // Return 200 even on error to prevent Telegram from retrying indefinitely
    return { statusCode: 200, body: 'ok' };
  }
}

async function handleCallback(callbackQuery: any): Promise<APIGatewayProxyResultV2> {
  const channelUserId = callbackQuery.from.id.toString();
  const callbackData = callbackQuery.data;

  const response = await agent!.handleConfirmation('telegram', channelUserId, callbackData);

  if (response) {
    await sendTelegramMessage(callbackQuery.message.chat.id, response.message_text);
  }

  // Answer the callback to remove the loading indicator
  await telegramApiCall('answerCallbackQuery', {
    callback_query_id: callbackQuery.id,
  });

  return { statusCode: 200, body: 'ok' };
}

async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>,
): Promise<void> {
  const payload: any = {
    chat_id: chatId,
    text,
  };

  if (inlineKeyboard) {
    payload.reply_markup = {
      inline_keyboard: inlineKeyboard.map((row) =>
        row.map((btn) => ({ text: btn.text, callback_data: btn.callback_data })),
      ),
    };
  }

  await telegramApiCall('sendMessage', payload);
}

async function telegramApiCall(method: string, payload: any): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Telegram API error (${method}):`, body);
  }

  return response.json();
}
