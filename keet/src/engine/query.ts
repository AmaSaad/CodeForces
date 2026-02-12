import { TransactionRepository } from '../db/dynamo/transaction.js';
import { ContactRepository } from '../db/dynamo/contact.js';
import { ItemRepository } from '../db/dynamo/item.js';
import type { Business, ParsedIntent, DailySummary } from '../types.js';
import { formatAmount } from '../utils/amount.js';
import { formatDate } from '../utils/date.js';

/**
 * Handles business queries — receivables, daily sales, balances, stock.
 */
export class QueryEngine {
  constructor(
    private transactions: TransactionRepository,
    private contacts: ContactRepository,
    private items: ItemRepository
  ) {}

  async handleQuery(business: Business, intent: ParsedIntent): Promise<string> {
    switch (intent.query_type) {
      case 'receivables':
        return this.getReceivablesReport(business);
      case 'daily_sales':
        return this.getDailySalesReport(business, intent.entities.date || new Date());
      case 'balance':
        return this.getContactBalanceReport(business, intent.entities.contact?.name || '');
      case 'stock':
        return this.getStockReport(business, intent.entities.items?.[0]?.name);
      default:
        return "I'm not sure what you're asking. Try: \"who owes me?\", \"what did I sell today?\", or \"how much cement do I have?\"";
    }
  }

  async getReceivablesReport(business: Business): Promise<string> {
    const receivables = await this.transactions.getReceivables(business.id);

    if (receivables.length === 0) {
      return 'No outstanding receivables. Everyone is paid up!';
    }

    const currency = business.currency;
    const lines = ['Outstanding receivables:'];

    for (let i = 0; i < receivables.length; i++) {
      const r = receivables[i];
      lines.push(
        `${i + 1}. ${r.contact_name} — ${formatAmount(r.balance, currency)} (${r.days_outstanding} days)`
      );
    }

    const total = receivables.reduce((sum, r) => sum + r.balance, 0);
    lines.push(`\nTotal: ${formatAmount(total, currency)}`);

    // Highlight overdue contacts (>30 days)
    const overdue = receivables.filter((r) => r.days_outstanding > 30);
    if (overdue.length > 0) {
      for (const r of overdue) {
        lines.push(`\n⚠ ${r.contact_name} is ${r.days_outstanding} days outstanding.`);
      }
    }

    return lines.join('\n');
  }

  async getDailySalesReport(business: Business, date: Date): Promise<string> {
    const summary = await this.transactions.getDailySummary(business.id, date);
    const currency = business.currency;

    if (summary.sales_count === 0 && summary.expenses === 0 && summary.payments_received === 0) {
      return `No transactions recorded for ${formatDate(date)}.`;
    }

    const lines = [`Summary for ${formatDate(date)}:`];

    if (summary.sales_count > 0) {
      lines.push(`• ${summary.sales_count} sales: ${formatAmount(summary.total_sales, currency)}`);
      if (summary.cash_sales > 0) {
        lines.push(`  - Cash: ${formatAmount(summary.cash_sales, currency)}`);
      }
      if (summary.credit_sales > 0) {
        lines.push(`  - Credit: ${formatAmount(summary.credit_sales, currency)}`);
      }
    }

    if (summary.payments_received > 0) {
      lines.push(`• Collected from debts: ${formatAmount(summary.payments_received, currency)}`);
    }

    if (summary.expenses > 0) {
      lines.push(`• Expenses: ${formatAmount(summary.expenses, currency)}`);
    }

    if (summary.new_credit_given > 0) {
      lines.push(`• New credit given: ${formatAmount(summary.new_credit_given, currency)}`);
    }

    return lines.join('\n');
  }

  async getContactBalanceReport(business: Business, contactName: string): Promise<string> {
    if (!contactName) {
      return 'Which contact do you want to check? Tell me their name.';
    }

    const contact = await this.contacts.findByName(business.id, contactName);
    if (!contact) {
      return `I don't have a contact named "${contactName}". They might be using a different name.`;
    }

    const balance = await this.transactions.getContactBalance(business.id, contact.id);
    const currency = business.currency;

    if (balance > 0) {
      return `${contact.name} owes you ${formatAmount(balance, currency)}.`;
    } else if (balance < 0) {
      return `You owe ${contact.name} ${formatAmount(Math.abs(balance), currency)}.`;
    } else {
      return `${contact.name} is all settled up. Balance: ${formatAmount(0, currency)}.`;
    }
  }

  async getStockReport(business: Business, itemName?: string): Promise<string> {
    if (itemName) {
      const item = await this.items.findByName(business.id, itemName);
      if (!item) {
        return `I don't have "${itemName}" in the catalog yet. Record a purchase or sale to start tracking it.`;
      }

      if (item.current_stock === null || item.current_stock === undefined) {
        return `I'm tracking ${item.name} but don't have a stock count yet. Record purchases and sales to build the count.`;
      }

      return `${item.name}: ${item.current_stock} ${item.unit || 'units'} in stock.`;
    }

    // All items with stock
    const allItems = await this.items.findByBusiness(business.id);
    const withStock = allItems.filter((i) => i.current_stock !== null);

    if (withStock.length === 0) {
      return 'No inventory tracked yet. Record purchases and sales to start building stock counts.';
    }

    const lines = ['Current stock:'];
    for (const item of withStock) {
      lines.push(`• ${item.name}: ${item.current_stock} ${item.unit || 'units'}`);
    }
    return lines.join('\n');
  }

  async generateEndOfDaySummary(business: Business): Promise<string> {
    const today = new Date();
    const summary = await this.transactions.getDailySummary(business.id, today);
    const receivables = await this.transactions.getReceivables(business.id);
    const currency = business.currency;

    const lines = ["Today's summary:"];

    lines.push(`• ${summary.sales_count} sales, total ${formatAmount(summary.total_sales, currency)}`);

    const cashCount = summary.cash_sales > 0 ? 1 : 0;
    const creditCount = summary.credit_sales > 0 ? 1 : 0;
    if (cashCount > 0 || creditCount > 0) {
      const parts = [];
      if (summary.cash_sales > 0) parts.push(`cash ${formatAmount(summary.cash_sales, currency)}`);
      if (summary.credit_sales > 0) parts.push(`credit ${formatAmount(summary.credit_sales, currency)}`);
      lines.push(`  (${parts.join(', ')})`);
    }

    if (summary.payments_received > 0) {
      lines.push(`• Collected ${formatAmount(summary.payments_received, currency)} from old debts`);
    }

    if (summary.new_credit_given > 0) {
      lines.push(`• New credit given: ${formatAmount(summary.new_credit_given, currency)}`);
    }

    if (summary.expenses > 0) {
      lines.push(`• Expenses: ${formatAmount(summary.expenses, currency)}`);
    }

    const totalReceivables = receivables.reduce((sum, r) => sum + r.balance, 0);
    if (totalReceivables > 0) {
      lines.push(`\nTotal outstanding: ${formatAmount(totalReceivables, currency)} from ${receivables.length} contacts`);
    }

    return lines.join('\n');
  }
}
