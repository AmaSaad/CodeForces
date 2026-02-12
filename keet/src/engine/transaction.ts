import { TransactionRepository } from '../db/dynamo/transaction.js';
import { ContactResolver } from './contact.js';
import { ItemResolver } from './item.js';
import type {
  Transaction,
  ParsedIntent,
  Business,
  TransactionItem,
} from '../types.js';
import { formatAmount } from '../utils/amount.js';

export interface RecordResult {
  transaction: Transaction;
  contact_name?: string;
  contact_balance?: number;
  confirmation_text: string;
}

/**
 * Core transaction recording engine.
 * Takes a parsed intent and creates the appropriate ledger entries.
 */
export class TransactionEngine {
  constructor(
    private transactions: TransactionRepository,
    private contactResolver: ContactResolver,
    private itemResolver: ItemResolver
  ) {}

  async recordFromIntent(
    business: Business,
    intent: ParsedIntent,
    originalMessage: string,
    sourceChannel: Transaction['source_channel']
  ): Promise<RecordResult> {
    const { entities, transaction_type } = intent;

    // Resolve contact
    let contact = null;
    let contactName = entities.contact?.name;
    if (contactName) {
      const role = transaction_type === 'purchase' ? 'supplier'
        : transaction_type === 'salary' ? 'employee'
        : 'customer';
      contact = await this.contactResolver.resolve(business.id, contactName, { role });
    }

    // Resolve items and compute total
    const resolvedItems: TransactionItem[] = [];
    let computedTotal = 0;

    if (entities.items && entities.items.length > 0) {
      for (const item of entities.items) {
        const resolved = await this.itemResolver.resolve(business.id, item.name, {
          price: item.price,
          unit: item.unit,
        });

        const unitPrice = item.price || (resolved?.current_price ? Number(resolved.current_price) : 0);
        const total = unitPrice * item.quantity;

        resolvedItems.push({
          item_id: resolved?.id,
          name: item.name,
          quantity: item.quantity,
          unit_price: unitPrice,
          total,
        });

        computedTotal += total;

        // Update stock
        if (resolved) {
          if (transaction_type === 'sale' || transaction_type === 'return') {
            await this.itemResolver.updateStockForSale(business.id, resolved.id, item.quantity);
          } else if (transaction_type === 'purchase') {
            await this.itemResolver.updateStockForPurchase(business.id, resolved.id, item.quantity);
          }
        }
      }
    }

    // Determine final amount
    const totalAmount = entities.amount || computedTotal;

    // Determine payment
    let amountPaid = 0;
    let paymentMethod: Transaction['payment_method'] = 'cash';

    if (entities.payment_method === 'credit') {
      amountPaid = 0;
      paymentMethod = 'credit';
    } else if (entities.payment_method === 'partial') {
      amountPaid = entities.amount_paid || 0;
      paymentMethod = 'partial';
    } else if (entities.amount_paid !== undefined) {
      amountPaid = entities.amount_paid;
      paymentMethod = amountPaid < totalAmount ? 'partial' : 'cash';
    } else {
      amountPaid = totalAmount;
      paymentMethod = 'cash';
    }

    // Create transaction
    const txn = await this.transactions.create({
      business_id: business.id,
      type: transaction_type || 'sale',
      contact_id: contact?.id,
      contact_name: contact?.name || contactName,
      items: resolvedItems,
      total_amount: totalAmount,
      amount_paid: amountPaid,
      payment_method: paymentMethod,
      is_personal: false,
      category: entities.category,
      description: entities.description,
      original_message: originalMessage,
      parsed_confidence: intent.confidence,
      source_channel: sourceChannel,
      transaction_date: entities.date || new Date(),
    });

    // Get updated contact balance
    let contactBalance: number | undefined;
    if (contact) {
      contactBalance = await this.transactions.getContactBalance(business.id, contact.id);
    }

    // Generate confirmation text
    const confirmation = this.generateConfirmation(
      txn,
      contact?.name || contactName,
      contactBalance,
      business.currency,
      resolvedItems
    );

    return {
      transaction: txn,
      contact_name: contact?.name || contactName,
      contact_balance: contactBalance,
      confirmation_text: confirmation,
    };
  }

  async recordPaymentReceived(
    business: Business,
    intent: ParsedIntent,
    originalMessage: string,
    sourceChannel: Transaction['source_channel']
  ): Promise<RecordResult> {
    const { entities } = intent;

    let contact = null;
    if (entities.contact?.name) {
      contact = await this.contactResolver.resolve(business.id, entities.contact.name);
    }

    const amount = entities.amount || 0;

    const txn = await this.transactions.create({
      business_id: business.id,
      type: 'payment_received',
      contact_id: contact?.id,
      contact_name: contact?.name || entities.contact?.name,
      items: [],
      total_amount: amount,
      amount_paid: amount,
      payment_method: 'cash',
      original_message: originalMessage,
      parsed_confidence: intent.confidence,
      source_channel: sourceChannel,
    });

    let contactBalance: number | undefined;
    if (contact) {
      contactBalance = await this.transactions.getContactBalance(business.id, contact.id);
    }

    const currency = business.currency;
    let text = `Got it. Received ${formatAmount(amount, currency)}`;
    if (contact) {
      text += ` from ${contact.name}`;
      if (contactBalance !== undefined) {
        if (contactBalance > 0) {
          text += `. ${contact.name} still owes you ${formatAmount(contactBalance, currency)}.`;
        } else if (contactBalance === 0) {
          text += `. ${contact.name} is all settled up!`;
        } else {
          text += `. You now owe ${contact.name} ${formatAmount(Math.abs(contactBalance), currency)}.`;
        }
      }
    }

    return {
      transaction: txn,
      contact_name: contact?.name,
      contact_balance: contactBalance,
      confirmation_text: text,
    };
  }

  async recordExpense(
    business: Business,
    intent: ParsedIntent,
    originalMessage: string,
    sourceChannel: Transaction['source_channel']
  ): Promise<RecordResult> {
    const { entities } = intent;
    const amount = entities.amount || 0;

    const txn = await this.transactions.create({
      business_id: business.id,
      type: 'expense',
      items: [],
      total_amount: amount,
      amount_paid: amount,
      payment_method: 'cash',
      category: entities.category,
      description: entities.description,
      original_message: originalMessage,
      parsed_confidence: intent.confidence,
      source_channel: sourceChannel,
    });

    const text = `Recorded expense: ${formatAmount(amount, business.currency)}${entities.category ? ` (${entities.category})` : ''}.`;

    return {
      transaction: txn,
      confirmation_text: text,
    };
  }

  async correctLastTransaction(
    business: Business,
    intent: ParsedIntent,
    originalMessage: string,
    sourceChannel: Transaction['source_channel']
  ): Promise<RecordResult | null> {
    const lastTxn = await this.transactions.getLastTransaction(business.id);
    if (!lastTxn) return null;

    const correction = intent.correction;
    if (!correction) return null;

    // Void the original (DynamoDB needs businessId + dateKey for composite key)
    // dateKey must match the YYYY-MM-DD format used in the SK
    const dateKey = (lastTxn as any)._dateKey
      || lastTxn.transaction_date.toISOString().split('T')[0];
    await this.transactions.voidTransaction(lastTxn.id, business.id, dateKey);

    // Determine what changed
    let newTotal = Number(lastTxn.total_amount);
    let newItems = typeof lastTxn.items === 'string' ? JSON.parse(lastTxn.items) : lastTxn.items;

    if (correction.field === 'quantity_or_amount') {
      // Check if the new_value matches a quantity or amount
      const newVal = correction.new_value;
      if (newItems.length > 0 && newItems[0].quantity) {
        const oldQty = newItems[0].quantity;
        const unitPrice = newItems[0].unit_price;
        // If old_value matches old quantity, update quantity
        if (correction.old_value === oldQty || correction.old_value === Number(lastTxn.total_amount)) {
          newItems[0].quantity = newVal;
          newItems[0].total = newVal * unitPrice;
          newTotal = newVal * unitPrice;
        } else {
          // Assume it's the total amount
          newTotal = newVal;
        }
      } else {
        newTotal = newVal;
      }
    }

    // Recalculate payment
    let amountPaid = 0;
    if (lastTxn.payment_method === 'cash') {
      amountPaid = newTotal;
    } else if (lastTxn.payment_method === 'partial') {
      amountPaid = Math.min(Number(lastTxn.amount_paid), newTotal);
    }

    // Resolve contact name for the corrected transaction's balance record
    let contactName: string | undefined;
    if (lastTxn.contact_id) {
      const contact = await this.contactResolver.findById(business.id, lastTxn.contact_id);
      contactName = contact?.name;
    }

    // Create corrected transaction
    const correctedTxn = await this.transactions.create({
      business_id: business.id,
      type: lastTxn.type as Transaction['type'],
      contact_id: lastTxn.contact_id || undefined,
      contact_name: contactName,
      items: newItems,
      total_amount: newTotal,
      amount_paid: amountPaid,
      payment_method: lastTxn.payment_method as Transaction['payment_method'],
      original_message: originalMessage,
      parsed_confidence: intent.confidence,
      source_channel: sourceChannel,
    });

    // Record the correction link
    await this.transactions.createCorrection({
      business_id: business.id,
      original_transaction_id: lastTxn.id,
      corrected_transaction_id: correctedTxn.id,
      correction_message: originalMessage,
    });

    let contactBalance: number | undefined;
    if (lastTxn.contact_id) {
      contactBalance = await this.transactions.getContactBalance(business.id, lastTxn.contact_id);
    }

    const text = `Corrected. Updated to ${formatAmount(newTotal, business.currency)}.${contactBalance !== undefined ? ` New balance: ${formatAmount(contactBalance, business.currency)}.` : ''}`;

    return {
      transaction: correctedTxn,
      contact_name: contactName,
      contact_balance: contactBalance,
      confirmation_text: text,
    };
  }

  private generateConfirmation(
    txn: Transaction,
    contactName: string | undefined,
    contactBalance: number | undefined,
    currency: string,
    items: TransactionItem[]
  ): string {
    const parts: string[] = [];
    const total = formatAmount(Number(txn.total_amount), currency);

    // Transaction description
    switch (txn.type) {
      case 'sale': {
        if (contactName && items.length > 0) {
          const itemDesc = items.map((i) => `${i.quantity} ${i.name}`).join(', ');
          if (txn.payment_method === 'credit') {
            parts.push(`${contactName} took ${itemDesc} (${total}) on credit.`);
          } else if (txn.payment_method === 'partial') {
            parts.push(
              `Sold ${itemDesc} to ${contactName} for ${total}. ` +
              `Received ${formatAmount(Number(txn.amount_paid), currency)} cash.`
            );
          } else {
            parts.push(`Sold ${itemDesc} to ${contactName} for ${total} cash.`);
          }
        } else {
          parts.push(`Sale recorded: ${total}.`);
        }
        break;
      }
      case 'purchase': {
        const itemDesc = items.map((i) => `${i.quantity} ${i.name}`).join(', ');
        parts.push(`Purchased ${itemDesc} for ${total}${contactName ? ` from ${contactName}` : ''}.`);
        break;
      }
      case 'expense': {
        parts.push(`Expense recorded: ${total}${txn.category ? ` (${txn.category})` : ''}.`);
        break;
      }
      case 'salary': {
        parts.push(`Salary payment: ${total}${contactName ? ` to ${contactName}` : ''}.`);
        break;
      }
      default: {
        parts.push(`Transaction recorded: ${total}.`);
      }
    }

    // Running balance for the contact
    if (contactBalance !== undefined && contactName) {
      if (contactBalance > 0) {
        parts.push(`${contactName} now owes you ${formatAmount(contactBalance, currency)} total.`);
      } else if (contactBalance < 0) {
        parts.push(`You now owe ${contactName} ${formatAmount(Math.abs(contactBalance), currency)}.`);
      }
    }

    return parts.join(' ');
  }
}
