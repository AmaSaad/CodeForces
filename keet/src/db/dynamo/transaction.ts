import { v4 as uuid } from 'uuid';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TABLE_NAME } from './client.js';
import { keys, prefixes, toDateKey } from './keys.js';
import type { Transaction, TransactionItem, Correction, DailySummary } from '../../types.js';

/**
 * Transaction repository with pre-computed aggregates.
 *
 * Every write uses TransactWriteItems to atomically:
 * 1. Store the transaction
 * 2. Denormalize under contact partition (if applicable)
 * 3. Update running balance for the contact (BAL#)
 * 4. Update daily summary counters (DAYSUM#)
 *
 * This means reads like getContactBalance() and getDailySummary()
 * are single GetItem calls — O(1), not aggregations.
 */
export class TransactionRepository {
  private doc = getDocClient();

  async create(params: {
    business_id: string;
    type: Transaction['type'];
    contact_id?: string;
    contact_name?: string;
    items: TransactionItem[];
    total_amount: number;
    amount_paid: number;
    payment_method: Transaction['payment_method'];
    is_personal?: boolean;
    category?: string;
    description?: string;
    original_message: string;
    parsed_confidence: number;
    source_channel: Transaction['source_channel'];
    transaction_date?: Date;
  }): Promise<Transaction> {
    const id = uuid();
    const txnDate = params.transaction_date || new Date();
    const dateKey = toDateKey(txnDate);
    const now = new Date().toISOString();

    const txn: Record<string, any> = {
      ...keys.transaction(params.business_id, dateKey, id),
      id,
      business_id: params.business_id,
      type: params.type,
      contact_id: params.contact_id || null,
      items: params.items,
      total_amount: params.total_amount,
      amount_paid: params.amount_paid,
      payment_method: params.payment_method,
      is_personal: params.is_personal || false,
      category: params.category || null,
      description: params.description || null,
      original_message: params.original_message,
      parsed_confidence: params.parsed_confidence,
      source_channel: params.source_channel,
      transaction_date: txnDate.toISOString(),
      voided: false,
      created_at: now,
      updated_at: now,
      _dateKey: dateKey, // Stored for void/correction lookups
    };

    const transactItems: any[] = [
      { Put: { TableName: TABLE_NAME, Item: txn } },
    ];

    // Denormalize under contact partition
    if (params.contact_id) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: {
            ...keys.contactTransaction(params.business_id, params.contact_id, dateKey, id),
            ...txn,
          },
        },
      });

      // Update running balance atomically
      const balanceDelta = this.computeBalanceDelta(params.type, params.total_amount, params.amount_paid);
      const balanceUpdate: any = {
        TableName: TABLE_NAME,
        Key: keys.balance(params.business_id, params.contact_id),
        UpdateExpression: `SET balance = if_not_exists(balance, :zero) + :delta,
          oldest_credit_date = if_not_exists(oldest_credit_date, :txnDate),
          total_transactions = if_not_exists(total_transactions, :zero) + :one,
          contact_name = if_not_exists(contact_name, :cname),
          updated_at = :now`,
        ExpressionAttributeValues: {
          ':delta': balanceDelta,
          ':zero': 0,
          ':one': 1,
          ':txnDate': txnDate.toISOString(),
          ':cname': params.contact_name || 'Unknown',
          ':now': now,
        },
      };
      transactItems.push({ Update: balanceUpdate });
    }

    // Update daily summary atomically
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: keys.dailySummary(params.business_id, dateKey),
        UpdateExpression: this.buildDailySummaryUpdate(params.type, params.total_amount, params.amount_paid, params.payment_method),
        ExpressionAttributeValues: this.buildDailySummaryValues(params.type, params.total_amount, params.amount_paid, params.payment_method),
      },
    });

    await this.doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return this.toTransaction(txn);
  }

  async voidTransaction(id: string, businessId?: string, dateKey?: string): Promise<void> {
    // If we don't have businessId/dateKey, we need to find the transaction first
    // The engine always has the transaction object, so this path is for safety
    if (!businessId || !dateKey) {
      throw new Error('businessId and dateKey required to void a DynamoDB transaction');
    }

    // Get the transaction to know what to reverse
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.transaction(businessId, dateKey, id),
    }));

    if (!Item || Item.voided) return;

    const transactItems: any[] = [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: keys.transaction(businessId, dateKey, id),
          UpdateExpression: 'SET voided = :t, updated_at = :now',
          ExpressionAttributeValues: { ':t': true, ':now': new Date().toISOString() },
        },
      },
    ];

    // Reverse the balance change
    if (Item.contact_id) {
      const reverseDelta = -this.computeBalanceDelta(Item.type, Item.total_amount, Item.amount_paid);
      if (reverseDelta !== 0) {
        transactItems.push({
          Update: {
            TableName: TABLE_NAME,
            Key: keys.balance(businessId, Item.contact_id),
            UpdateExpression: 'SET balance = if_not_exists(balance, :zero) + :delta, updated_at = :now',
            ExpressionAttributeValues: {
              ':delta': reverseDelta,
              ':zero': 0,
              ':now': new Date().toISOString(),
            },
          },
        });
      }

      // Void the denormalized contact copy too
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: keys.contactTransaction(businessId, Item.contact_id, dateKey, id),
          UpdateExpression: 'SET voided = :t',
          ExpressionAttributeValues: { ':t': true },
        },
      });
    }

    // Reverse daily summary (subtract what was added)
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: keys.dailySummary(businessId, dateKey),
        UpdateExpression: this.buildDailySummaryUpdate(Item.type, -Item.total_amount, -Item.amount_paid, Item.payment_method),
        ExpressionAttributeValues: this.buildDailySummaryValues(Item.type, -Item.total_amount, -Item.amount_paid, Item.payment_method),
      },
    });

    await this.doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
  }

  async createCorrection(params: {
    business_id: string;
    original_transaction_id: string;
    corrected_transaction_id: string;
    correction_message: string;
  }): Promise<Correction> {
    const id = uuid();
    const dateKey = toDateKey(new Date());
    const item = {
      ...keys.correction(params.business_id, dateKey, id),
      id,
      business_id: params.business_id,
      original_transaction_id: params.original_transaction_id,
      corrected_transaction_id: params.corrected_transaction_id,
      correction_message: params.correction_message,
      created_at: new Date().toISOString(),
    };

    await this.doc.send(new TransactWriteCommand({
      TransactItems: [{ Put: { TableName: TABLE_NAME, Item: item } }],
    }));

    return {
      id,
      business_id: params.business_id,
      original_transaction_id: params.original_transaction_id,
      corrected_transaction_id: params.corrected_transaction_id,
      correction_message: params.correction_message,
      created_at: new Date(),
    };
  }

  async getLastTransaction(businessId: string): Promise<Transaction | null> {
    const p = prefixes.transactions(businessId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': p.PK, ':prefix': p.SKprefix },
      ScanIndexForward: false, // Newest first
      Limit: 5, // Get a few in case the latest is voided
    }));

    for (const item of Items) {
      if (!item.voided) return this.toTransaction(item);
    }
    return null;
  }

  async getRecentTransactions(businessId: string, limit: number = 10): Promise<Transaction[]> {
    const p = prefixes.transactions(businessId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': p.PK, ':prefix': p.SKprefix },
      ScanIndexForward: false,
      Limit: limit + 10, // Over-fetch to account for voided
    }));

    return Items.filter((i) => !i.voided).slice(0, limit).map((i) => this.toTransaction(i));
  }

  /**
   * O(1) — reads the pre-computed balance item.
   * Updated atomically with every transaction write.
   */
  async getContactBalance(businessId: string, contactId: string): Promise<number> {
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.balance(businessId, contactId),
    }));
    return Item?.balance ? Number(Item.balance) : 0;
  }

  /**
   * Queries all BAL# items for the business, filters balance > 0.
   * Each BAL# item is pre-computed, so this is a single query + filter.
   */
  async getReceivables(businessId: string): Promise<Array<{
    contact_id: string;
    contact_name: string;
    balance: number;
    oldest_date: Date;
    days_outstanding: number;
  }>> {
    const p = prefixes.balances(businessId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': p.PK, ':prefix': p.SKprefix },
    }));

    const now = Date.now();
    return Items
      .filter((item) => Number(item.balance) > 0)
      .map((item) => {
        const oldestDate = item.oldest_credit_date ? new Date(item.oldest_credit_date) : new Date();
        return {
          contact_id: item.SK.replace('BAL#', ''),
          contact_name: item.contact_name || 'Unknown',
          balance: Number(item.balance),
          oldest_date: oldestDate,
          days_outstanding: Math.floor((now - oldestDate.getTime()) / (1000 * 60 * 60 * 24)),
        };
      })
      .sort((a, b) => b.balance - a.balance);
  }

  /**
   * O(1) — reads the pre-computed daily summary item.
   */
  async getDailySummary(businessId: string, date: Date): Promise<DailySummary> {
    const dateKey = toDateKey(date);
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.dailySummary(businessId, dateKey),
    }));

    if (!Item) {
      return {
        date,
        total_sales: 0,
        sales_count: 0,
        cash_sales: 0,
        credit_sales: 0,
        payments_received: 0,
        expenses: 0,
        new_credit_given: 0,
      };
    }

    return {
      date,
      total_sales: Number(Item.total_sales || 0),
      sales_count: Number(Item.sales_count || 0),
      cash_sales: Number(Item.cash_sales || 0),
      credit_sales: Number(Item.credit_sales || 0),
      payments_received: Number(Item.payments_received || 0),
      expenses: Number(Item.expenses || 0),
      new_credit_given: Number(Item.new_credit_given || 0),
    };
  }

  async getTransactionsByContact(businessId: string, contactId: string, limit: number = 20): Promise<Transaction[]> {
    const p = prefixes.contactTransactions(businessId, contactId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': p.PK, ':prefix': p.SKprefix },
      ScanIndexForward: false,
      Limit: limit,
    }));

    return Items.filter((i) => !i.voided).map((i) => this.toTransaction(i));
  }

  // ─── Private: Balance delta computation ───

  /**
   * Computes how much a transaction changes a contact's balance.
   * Positive = they owe more. Negative = they owe less.
   * Must match the SQL CASE logic exactly.
   */
  private computeBalanceDelta(type: string, totalAmount: number, amountPaid: number): number {
    switch (type) {
      case 'sale':
        return totalAmount - amountPaid; // Credit portion they owe
      case 'payment_received':
        return -totalAmount; // They paid us
      case 'purchase':
        return -(totalAmount - amountPaid); // We owe them (negative = they're owed)
      case 'payment_made':
        return totalAmount; // We paid them (reduces what we owe)
      case 'return':
        return -totalAmount; // Returned goods reduce what they owe
      default:
        return 0;
    }
  }

  // ─── Private: Daily summary atomic update ───

  private buildDailySummaryUpdate(type: string, totalAmount: number, amountPaid: number, paymentMethod: string): string {
    const parts = ['SET updated_at = :now'];

    switch (type) {
      case 'sale':
        parts.push('total_sales = if_not_exists(total_sales, :zero) + :totalAmt');
        parts.push('sales_count = if_not_exists(sales_count, :zero) + :one');
        if (paymentMethod === 'cash') {
          parts.push('cash_sales = if_not_exists(cash_sales, :zero) + :totalAmt');
        } else {
          parts.push('credit_sales = if_not_exists(credit_sales, :zero) + :totalAmt');
        }
        parts.push('new_credit_given = if_not_exists(new_credit_given, :zero) + :creditAmt');
        break;
      case 'payment_received':
        parts.push('payments_received = if_not_exists(payments_received, :zero) + :totalAmt');
        break;
      case 'expense':
        parts.push('expenses = if_not_exists(expenses, :zero) + :totalAmt');
        break;
    }

    return parts.join(', ');
  }

  private buildDailySummaryValues(type: string, totalAmount: number, amountPaid: number, paymentMethod: string): Record<string, any> {
    const values: Record<string, any> = {
      ':now': new Date().toISOString(),
      ':zero': 0,
    };

    switch (type) {
      case 'sale':
        values[':totalAmt'] = totalAmount;
        // Sign-aware: +1 for recording, -1 for voiding (totalAmount is negative when voiding)
        values[':one'] = totalAmount >= 0 ? 1 : -1;
        values[':creditAmt'] = totalAmount - amountPaid;
        break;
      case 'payment_received':
        values[':totalAmt'] = totalAmount;
        break;
      case 'expense':
        values[':totalAmt'] = totalAmount;
        break;
    }

    return values;
  }

  // ─── Private: Mapper ───

  private toTransaction(item: Record<string, any>): Transaction {
    const txn: any = {
      id: item.id,
      business_id: item.business_id,
      type: item.type,
      contact_id: item.contact_id || null,
      items: item.items || [],
      total_amount: Number(item.total_amount),
      amount_paid: Number(item.amount_paid),
      payment_method: item.payment_method,
      is_personal: item.is_personal || false,
      category: item.category || null,
      description: item.description || null,
      original_message: item.original_message,
      parsed_confidence: Number(item.parsed_confidence),
      source_channel: item.source_channel,
      transaction_date: new Date(item.transaction_date),
      voided: item.voided || false,
      created_at: new Date(item.created_at),
      updated_at: new Date(item.updated_at),
    };
    // Carry the DynamoDB dateKey so void/correction can reconstruct the SK
    if (item._dateKey) txn._dateKey = item._dateKey;
    return txn as Transaction;
  }
}
