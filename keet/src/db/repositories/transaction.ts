import { v4 as uuid } from 'uuid';
import { query, transaction as dbTransaction } from '../index.js';
import type { Transaction, TransactionItem, Correction, DailySummary } from '../../types.js';

export class TransactionRepository {
  async create(params: {
    business_id: string;
    type: Transaction['type'];
    contact_id?: string;
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
    const result = await query<Transaction>(
      `INSERT INTO transactions (
        id, business_id, type, contact_id, items, total_amount, amount_paid,
        payment_method, is_personal, category, description,
        original_message, parsed_confidence, source_channel, transaction_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        id,
        params.business_id,
        params.type,
        params.contact_id || null,
        JSON.stringify(params.items),
        params.total_amount,
        params.amount_paid,
        params.payment_method,
        params.is_personal || false,
        params.category || null,
        params.description || null,
        params.original_message,
        params.parsed_confidence,
        params.source_channel,
        params.transaction_date || new Date(),
      ]
    );
    return result.rows[0];
  }

  async voidTransaction(id: string): Promise<void> {
    await query(
      'UPDATE transactions SET voided = TRUE, updated_at = NOW() WHERE id = $1',
      [id]
    );
  }

  async createCorrection(params: {
    business_id: string;
    original_transaction_id: string;
    corrected_transaction_id: string;
    correction_message: string;
  }): Promise<Correction> {
    const id = uuid();
    const result = await query<Correction>(
      `INSERT INTO corrections (id, business_id, original_transaction_id, corrected_transaction_id, correction_message)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, params.business_id, params.original_transaction_id, params.corrected_transaction_id, params.correction_message]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<Transaction | null> {
    const result = await query<Transaction>(
      'SELECT * FROM transactions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async getLastTransaction(businessId: string): Promise<Transaction | null> {
    const result = await query<Transaction>(
      `SELECT * FROM transactions
       WHERE business_id = $1 AND voided = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [businessId]
    );
    return result.rows[0] || null;
  }

  async getRecentTransactions(businessId: string, limit: number = 10): Promise<Transaction[]> {
    const result = await query<Transaction>(
      `SELECT * FROM transactions
       WHERE business_id = $1 AND voided = FALSE
       ORDER BY transaction_date DESC LIMIT $2`,
      [businessId, limit]
    );
    return result.rows;
  }

  async getContactBalance(businessId: string, contactId: string): Promise<number> {
    // Positive = they owe us, Negative = we owe them
    const result = await query<{ balance: string }>(
      `SELECT COALESCE(SUM(
        CASE
          WHEN type IN ('sale') THEN total_amount - amount_paid
          WHEN type IN ('payment_received') THEN -total_amount
          WHEN type IN ('purchase') THEN -(total_amount - amount_paid)
          WHEN type IN ('payment_made') THEN total_amount
          WHEN type IN ('return') THEN
            CASE WHEN contact_id IS NOT NULL THEN -total_amount ELSE 0 END
          ELSE 0
        END
      ), 0) AS balance
      FROM transactions
      WHERE business_id = $1 AND contact_id = $2 AND voided = FALSE`,
      [businessId, contactId]
    );
    return parseFloat(result.rows[0].balance);
  }

  async getReceivables(businessId: string): Promise<Array<{
    contact_id: string;
    contact_name: string;
    balance: number;
    oldest_date: Date;
    days_outstanding: number;
  }>> {
    const result = await query<{
      contact_id: string;
      contact_name: string;
      balance: string;
      oldest_date: Date;
      days_outstanding: string;
    }>(
      `WITH contact_balances AS (
        SELECT
          t.contact_id,
          c.name AS contact_name,
          SUM(
            CASE
              WHEN t.type IN ('sale') THEN t.total_amount - t.amount_paid
              WHEN t.type IN ('payment_received') THEN -t.total_amount
              WHEN t.type IN ('return') THEN -t.total_amount
              ELSE 0
            END
          ) AS balance,
          MIN(CASE WHEN t.type = 'sale' AND t.total_amount > t.amount_paid THEN t.transaction_date END) AS oldest_date
        FROM transactions t
        JOIN contacts c ON c.id = t.contact_id
        WHERE t.business_id = $1 AND t.voided = FALSE AND t.contact_id IS NOT NULL
        GROUP BY t.contact_id, c.name
        HAVING SUM(
          CASE
            WHEN t.type IN ('sale') THEN t.total_amount - t.amount_paid
            WHEN t.type IN ('payment_received') THEN -t.total_amount
            WHEN t.type IN ('return') THEN -t.total_amount
            ELSE 0
          END
        ) > 0
      )
      SELECT
        contact_id,
        contact_name,
        balance,
        oldest_date,
        EXTRACT(DAY FROM NOW() - oldest_date)::INTEGER AS days_outstanding
      FROM contact_balances
      ORDER BY balance DESC`,
      [businessId]
    );

    return result.rows.map((r) => ({
      contact_id: r.contact_id,
      contact_name: r.contact_name,
      balance: parseFloat(r.balance),
      oldest_date: r.oldest_date,
      days_outstanding: parseInt(r.days_outstanding) || 0,
    }));
  }

  async getDailySummary(businessId: string, date: Date): Promise<DailySummary> {
    const dateStr = date.toISOString().split('T')[0];

    const result = await query<{
      total_sales: string;
      sales_count: string;
      cash_sales: string;
      credit_sales: string;
      payments_received: string;
      expenses: string;
      new_credit_given: string;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'sale' THEN total_amount ELSE 0 END), 0) AS total_sales,
        COUNT(CASE WHEN type = 'sale' THEN 1 END) AS sales_count,
        COALESCE(SUM(CASE WHEN type = 'sale' AND payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN type = 'sale' AND payment_method = 'credit' THEN total_amount ELSE 0 END), 0) AS credit_sales,
        COALESCE(SUM(CASE WHEN type = 'payment_received' THEN total_amount ELSE 0 END), 0) AS payments_received,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN total_amount ELSE 0 END), 0) AS expenses,
        COALESCE(SUM(CASE WHEN type = 'sale' THEN total_amount - amount_paid ELSE 0 END), 0) AS new_credit_given
      FROM transactions
      WHERE business_id = $1
        AND voided = FALSE
        AND transaction_date::date = $2::date`,
      [businessId, dateStr]
    );

    const r = result.rows[0];
    return {
      date,
      total_sales: parseFloat(r.total_sales),
      sales_count: parseInt(r.sales_count),
      cash_sales: parseFloat(r.cash_sales),
      credit_sales: parseFloat(r.credit_sales),
      payments_received: parseFloat(r.payments_received),
      expenses: parseFloat(r.expenses),
      new_credit_given: parseFloat(r.new_credit_given),
    };
  }

  async getTransactionsByContact(businessId: string, contactId: string, limit: number = 20): Promise<Transaction[]> {
    const result = await query<Transaction>(
      `SELECT * FROM transactions
       WHERE business_id = $1 AND contact_id = $2 AND voided = FALSE
       ORDER BY transaction_date DESC LIMIT $3`,
      [businessId, contactId, limit]
    );
    return result.rows;
  }
}
