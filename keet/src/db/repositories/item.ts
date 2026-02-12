import { v4 as uuid } from 'uuid';
import { query } from '../index.js';
import type { Item, ItemPriceHistory } from '../../types.js';

export class ItemRepository {
  async findByName(businessId: string, name: string): Promise<Item | null> {
    // Exact name match
    let result = await query<Item>(
      'SELECT * FROM items WHERE business_id = $1 AND LOWER(name) = LOWER($2)',
      [businessId, name]
    );
    if (result.rows[0]) return result.rows[0];

    // Check aliases
    result = await query<Item>(
      `SELECT * FROM items WHERE business_id = $1
       AND EXISTS (
         SELECT 1 FROM unnest(aliases) alias WHERE LOWER(alias) = LOWER($2)
       )`,
      [businessId, name]
    );
    return result.rows[0] || null;
  }

  async findById(id: string): Promise<Item | null> {
    const result = await query<Item>('SELECT * FROM items WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async findByBusiness(businessId: string): Promise<Item[]> {
    const result = await query<Item>(
      'SELECT * FROM items WHERE business_id = $1 ORDER BY name',
      [businessId]
    );
    return result.rows;
  }

  async create(params: {
    business_id: string;
    name: string;
    unit?: string;
    current_price?: number;
    aliases?: string[];
    category?: string;
  }): Promise<Item> {
    const id = uuid();
    const result = await query<Item>(
      `INSERT INTO items (id, business_id, name, unit, current_price, aliases, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        params.business_id,
        params.name,
        params.unit || null,
        params.current_price || null,
        params.aliases || [],
        params.category || null,
      ]
    );

    // Record initial price if provided
    if (params.current_price) {
      await this.recordPrice(id, params.current_price, 'transaction');
    }

    return result.rows[0];
  }

  async updatePrice(id: string, price: number): Promise<void> {
    await query(
      'UPDATE items SET current_price = $2, updated_at = NOW() WHERE id = $1',
      [id, price]
    );
    await this.recordPrice(id, price, 'transaction');
  }

  async updateStock(id: string, stockChange: number): Promise<void> {
    await query(
      `UPDATE items SET current_stock = COALESCE(current_stock, 0) + $2, updated_at = NOW()
       WHERE id = $1`,
      [id, stockChange]
    );
  }

  async recordPrice(itemId: string, price: number, source: 'transaction' | 'manual'): Promise<void> {
    await query(
      'INSERT INTO item_price_history (id, item_id, price, source) VALUES ($1, $2, $3, $4)',
      [uuid(), itemId, price, source]
    );
  }

  async addAlias(id: string, alias: string): Promise<void> {
    await query(
      `UPDATE items SET aliases = array_append(aliases, $2), updated_at = NOW()
       WHERE id = $1 AND NOT ($2 = ANY(aliases))`,
      [id, alias]
    );
  }

  async getRecentItems(businessId: string, limit: number = 10): Promise<Item[]> {
    const result = await query<Item>(
      'SELECT * FROM items WHERE business_id = $1 ORDER BY updated_at DESC LIMIT $2',
      [businessId, limit]
    );
    return result.rows;
  }
}
