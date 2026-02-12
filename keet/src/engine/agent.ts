import { BusinessRepository } from '../db/repositories/business.js';
import { ContactRepository } from '../db/repositories/contact.js';
import { ItemRepository } from '../db/repositories/item.js';
import { TransactionRepository } from '../db/repositories/transaction.js';
import { ConfirmationRepository } from '../db/repositories/confirmation.js';
import { MessageParser } from '../parser/index.js';
import { TransactionEngine } from './transaction.js';
import { QueryEngine } from './query.js';
import { OnboardingEngine } from './onboarding.js';
import { ContactResolver } from './contact.js';
import { ItemResolver } from './item.js';
import { detectLanguage } from '../utils/arabic.js';
import type { IncomingMessage, AgentResponse, BusinessContext, Business } from '../types.js';

/**
 * The main Keet agent — the brain that processes every message.
 * Channel-agnostic: works the same whether message comes from
 * Telegram, WhatsApp, or web.
 */
export class KeetAgent {
  private businesses: BusinessRepository;
  private contacts: ContactRepository;
  private items: ItemRepository;
  private transactions: TransactionRepository;
  private confirmations: ConfirmationRepository;
  private parser: MessageParser;
  private txnEngine: TransactionEngine;
  private queryEngine: QueryEngine;
  private onboarding: OnboardingEngine;

  constructor() {
    this.businesses = new BusinessRepository();
    this.contacts = new ContactRepository();
    this.items = new ItemRepository();
    this.transactions = new TransactionRepository();
    this.confirmations = new ConfirmationRepository();
    this.parser = new MessageParser();

    const contactResolver = new ContactResolver(this.contacts);
    const itemResolver = new ItemResolver(this.items);

    this.txnEngine = new TransactionEngine(this.transactions, contactResolver, itemResolver);
    this.queryEngine = new QueryEngine(this.transactions, this.contacts, this.items);
    this.onboarding = new OnboardingEngine(this.businesses);
  }

  async processMessage(msg: IncomingMessage): Promise<AgentResponse> {
    const start = Date.now();

    try {
      // 1. Resolve or create business
      let business = await this.businesses.findByChannelUser(msg.channel, msg.channel_user_id);

      if (!business) {
        business = await this.createNewBusiness(msg);
        const lang = detectLanguage(msg.message_text);
        business.language_preference = lang === 'mixed' ? 'ar' : lang;

        return {
          message_text: this.onboarding.getWelcomeMessage(business.language_preference),
        };
      }

      // 2. Handle onboarding if not complete
      if (!business.onboarding_complete) {
        return this.handleOnboarding(business, msg);
      }

      // 3. Check for pending confirmation callbacks
      // (handled separately in callback handler)

      // 4. Build context for parser
      const context = await this.buildContext(business);

      // 5. Parse the message
      const intent = await this.parser.parse(msg.message_text, context);

      // 6. Route based on intent
      switch (intent.type) {
        case 'transaction':
          return this.handleTransaction(business, intent, msg);

        case 'query':
          return this.handleQuery(business, intent);

        case 'correction':
          return this.handleCorrection(business, intent, msg);

        case 'social':
          return this.handleSocial(business);

        case 'unknown':
        default:
          return this.handleUnknown(business);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      return {
        message_text: "Something went wrong on my end. Please try again.",
      };
    } finally {
      const duration = Date.now() - start;
      if (duration > 3000) {
        console.warn(`Slow message processing: ${duration}ms for ${msg.channel_user_id}`);
      }
    }
  }

  async handleConfirmation(
    channel: string,
    channelUserId: string,
    callbackData: string
  ): Promise<AgentResponse | null> {
    const pending = await this.confirmations.getLatestPending(channel, channelUserId);
    if (!pending) return null;

    await this.confirmations.resolve(pending.id);

    if (callbackData === 'confirm_yes') {
      // The pending confirmation data contains the parsed intent
      // Re-process it as confirmed
      const business = await this.businesses.findByChannelUser(channel, channelUserId);
      if (!business) return null;

      const data = typeof pending.data === 'string' ? JSON.parse(pending.data) : pending.data;
      const intent = data.intent;
      const originalMessage = data.original_message;

      let result;
      if (intent.transaction_type === 'payment_received') {
        result = await this.txnEngine.recordPaymentReceived(
          business, intent, originalMessage, channel as any
        );
      } else if (intent.transaction_type === 'expense') {
        result = await this.txnEngine.recordExpense(
          business, intent, originalMessage, channel as any
        );
      } else {
        result = await this.txnEngine.recordFromIntent(
          business, intent, originalMessage, channel as any
        );
      }

      return { message_text: result.confirmation_text };
    } else {
      return { message_text: 'Cancelled. What would you like to record?' };
    }
  }

  private async createNewBusiness(msg: IncomingMessage): Promise<Business> {
    const lang = detectLanguage(msg.message_text);
    const business = await this.businesses.create({
      phone_number: msg.phone_number || msg.channel_user_id,
      language_preference: lang === 'mixed' ? 'ar' : lang,
    });

    await this.businesses.linkChannel(
      business.id,
      msg.channel,
      msg.channel_user_id,
      msg.phone_number
    );

    return business;
  }

  private async handleOnboarding(business: Business, msg: IncomingMessage): Promise<AgentResponse> {
    const step = this.onboarding.determineOnboardingStep(business);
    const result = await this.onboarding.handleOnboardingMessage(business, msg.message_text, step);

    return { message_text: result.response };
  }

  private async handleTransaction(business: Business, intent: any, msg: IncomingMessage): Promise<AgentResponse> {
    // If confidence is low, ask for confirmation first
    if (intent.confidence < 0.6) {
      // Store pending confirmation
      await this.confirmations.create({
        business_id: business.id,
        channel: msg.channel,
        channel_user_id: msg.channel_user_id,
        confirmation_type: 'transaction',
        data: { intent, original_message: msg.message_text },
      });

      const desc = this.describeIntent(intent, business.currency);
      return {
        message_text: `I understood: ${desc}\nIs this correct?`,
        requires_confirmation: true,
        inline_keyboard: [
          [
            { text: '✅ Yes', callback_data: 'confirm_yes' },
            { text: '❌ No', callback_data: 'confirm_no' },
          ],
        ],
      };
    }

    // High confidence — record directly
    let result;
    if (intent.transaction_type === 'payment_received') {
      result = await this.txnEngine.recordPaymentReceived(
        business, intent, msg.message_text, msg.channel
      );
    } else if (intent.transaction_type === 'expense') {
      result = await this.txnEngine.recordExpense(
        business, intent, msg.message_text, msg.channel
      );
    } else {
      result = await this.txnEngine.recordFromIntent(
        business, intent, msg.message_text, msg.channel
      );
    }

    return { message_text: result.confirmation_text };
  }

  private async handleQuery(business: Business, intent: any): Promise<AgentResponse> {
    const response = await this.queryEngine.handleQuery(business, intent);
    return { message_text: response };
  }

  private async handleCorrection(business: Business, intent: any, msg: IncomingMessage): Promise<AgentResponse> {
    const result = await this.txnEngine.correctLastTransaction(
      business, intent, msg.message_text, msg.channel
    );

    if (!result) {
      return { message_text: "I couldn't find a recent transaction to correct. What would you like to change?" };
    }

    return { message_text: result.confirmation_text };
  }

  private handleSocial(business: Business): AgentResponse {
    const lang = business.language_preference;
    if (lang === 'ar') {
      return { message_text: 'أهلاً! ابعتلي أي معاملة وأنا هسجلها. 📝' };
    }
    return { message_text: "Hi! Send me any transaction and I'll record it. 📝" };
  }

  private handleUnknown(business: Business): AgentResponse {
    const lang = business.language_preference;
    if (lang === 'ar') {
      return {
        message_text:
          'مش فاهم أوي. جرب حاجة زي:\n' +
          '• "حسن اخد ٥٠ شكارة اسمنت بالآجل"\n' +
          '• "مين عليه فلوس؟"\n' +
          '• "بعت النهارده كام؟"',
      };
    }
    return {
      message_text:
        "I didn't quite catch that. Try something like:\n" +
        '• "Hassan took 50 bags cement on credit"\n' +
        '• "Who owes me money?"\n' +
        '• "What did I sell today?"',
    };
  }

  private describeIntent(intent: any, currency: string): string {
    const parts: string[] = [];
    const type = intent.transaction_type || 'transaction';

    if (intent.entities.contact?.name) {
      parts.push(intent.entities.contact.name);
    }

    if (intent.entities.items?.length > 0) {
      const itemDesc = intent.entities.items
        .map((i: any) => `${i.quantity} ${i.name}`)
        .join(', ');
      parts.push(itemDesc);
    }

    if (intent.entities.amount) {
      parts.push(`${currency} ${intent.entities.amount.toLocaleString()}`);
    }

    if (intent.entities.payment_method) {
      parts.push(intent.entities.payment_method);
    }

    return `${type}: ${parts.join(' — ')}`;
  }

  private async buildContext(business: Business): Promise<BusinessContext> {
    const [recentContacts, recentItems, recentTransactions] = await Promise.all([
      this.contacts.getRecentContacts(business.id, 15),
      this.items.getRecentItems(business.id, 15),
      this.transactions.getRecentTransactions(business.id, 10),
    ]);

    return {
      business,
      recent_contacts: recentContacts,
      recent_items: recentItems,
      recent_transactions: recentTransactions,
    };
  }
}
