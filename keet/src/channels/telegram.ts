import { Telegraf, Context } from 'telegraf';
import type { Update, Message } from 'telegraf/types';
import { config } from '../config.js';
import { KeetAgent } from '../engine/agent.js';
import type { IncomingMessage, AgentResponse } from '../types.js';
import type { ChannelAdapter } from './types.js';

/**
 * Telegram bot adapter — thin wrapper that converts Telegram messages
 * to IncomingMessage format and sends AgentResponses back.
 */
export class TelegramChannel implements ChannelAdapter {
  private bot: Telegraf;
  private agent: KeetAgent;

  constructor(agent: KeetAgent) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.agent = agent;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle /start command
    this.bot.start(async (ctx) => {
      const msg = this.toIncomingMessage(ctx);
      const response = await this.agent.processMessage(msg);
      await this.sendTelegramResponse(ctx, response);
    });

    // Handle text messages
    this.bot.on('text', async (ctx) => {
      const msg = this.toIncomingMessage(ctx);
      const response = await this.agent.processMessage(msg);
      await this.sendTelegramResponse(ctx, response);
    });

    // Handle callback queries (inline keyboard button presses)
    this.bot.on('callback_query', async (ctx) => {
      const callbackQuery = ctx.callbackQuery;
      if (!('data' in callbackQuery)) return;

      const channelUserId = callbackQuery.from.id.toString();
      const callbackData = callbackQuery.data;

      // Acknowledge the callback
      await ctx.answerCbQuery();

      const response = await this.agent.handleConfirmation(
        'telegram',
        channelUserId,
        callbackData
      );

      if (response) {
        await ctx.reply(response.message_text);
      }
    });

    // Handle contact sharing (for phone number identity)
    this.bot.on('contact', async (ctx) => {
      const contact = ctx.message.contact;
      if (contact.user_id === ctx.from?.id) {
        // User shared their own contact — use phone number as identity
        const msg: IncomingMessage = {
          channel: 'telegram',
          channel_user_id: ctx.from.id.toString(),
          phone_number: contact.phone_number,
          message_text: '/start',
          message_id: ctx.message.message_id.toString(),
          timestamp: new Date(ctx.message.date * 1000),
        };
        const response = await this.agent.processMessage(msg);
        await this.sendTelegramResponse(ctx, response);
      }
    });

    // Error handler
    this.bot.catch((err, ctx) => {
      console.error('Telegram bot error:', err);
    });
  }

  private toIncomingMessage(ctx: Context): IncomingMessage {
    const message = ctx.message as Message.TextMessage;
    return {
      channel: 'telegram',
      channel_user_id: ctx.from!.id.toString(),
      message_text: message?.text || '',
      message_id: message?.message_id?.toString() || '',
      timestamp: new Date((message?.date || 0) * 1000),
    };
  }

  private async sendTelegramResponse(ctx: Context, response: AgentResponse): Promise<void> {
    if (response.inline_keyboard) {
      await ctx.reply(response.message_text, {
        reply_markup: {
          inline_keyboard: response.inline_keyboard.map((row) =>
            row.map((btn) => ({
              text: btn.text,
              callback_data: btn.callback_data,
            }))
          ),
        },
      });
    } else {
      await ctx.reply(response.message_text);
    }
  }

  async sendResponse(channelUserId: string, response: AgentResponse): Promise<void> {
    if (response.inline_keyboard) {
      await this.bot.telegram.sendMessage(channelUserId, response.message_text, {
        reply_markup: {
          inline_keyboard: response.inline_keyboard.map((row) =>
            row.map((btn) => ({
              text: btn.text,
              callback_data: btn.callback_data,
            }))
          ),
        },
      });
    } else {
      await this.bot.telegram.sendMessage(channelUserId, response.message_text);
    }
  }

  async start(): Promise<void> {
    console.log('Starting Telegram bot...');
    await this.bot.launch();
    console.log('Telegram bot is running.');
  }

  async stop(): Promise<void> {
    this.bot.stop('Shutting down');
  }
}
