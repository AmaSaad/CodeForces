import { v4 as uuid } from 'uuid';
import { query } from '../index.js';
import type { Contact } from '../../types.js';

export class ContactRepository {
  async findByName(businessId: string, name: string): Promise<Contact | null> {
    // Exact name match first
    let result = await query<Contact>(
      'SELECT * FROM contacts WHERE business_id = $1 AND LOWER(name) = LOWER($2)',
      [businessId, name]
    );
    if (result.rows[0]) return result.rows[0];

    // Check aliases
    result = await query<Contact>(
      `SELECT * FROM contacts WHERE business_id = $1
       AND EXISTS (
         SELECT 1 FROM unnest(aliases) alias WHERE LOWER(alias) = LOWER($2)
       )`,
      [businessId, name]
    );
    return result.rows[0] || null;
  }

  async fuzzySearch(businessId: string, name: string): Promise<Contact[]> {
    // Search by name prefix or alias match (case-insensitive)
    const result = await query<Contact>(
      `SELECT * FROM contacts WHERE business_id = $1
       AND (
         LOWER(name) LIKE LOWER($2) || '%'
         OR EXISTS (
           SELECT 1 FROM unnest(aliases) alias WHERE LOWER(alias) LIKE LOWER($2) || '%'
         )
       )
       ORDER BY name
       LIMIT 5`,
      [businessId, name]
    );
    return result.rows;
  }

  async findById(id: string): Promise<Contact | null> {
    const result = await query<Contact>('SELECT * FROM contacts WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async findByBusiness(businessId: string): Promise<Contact[]> {
    const result = await query<Contact>(
      'SELECT * FROM contacts WHERE business_id = $1 ORDER BY updated_at DESC',
      [businessId]
    );
    return result.rows;
  }

  async create(params: {
    business_id: string;
    name: string;
    role?: 'customer' | 'supplier' | 'employee';
    aliases?: string[];
    phone?: string;
  }): Promise<Contact> {
    const id = uuid();
    const result = await query<Contact>(
      `INSERT INTO contacts (id, business_id, name, role, aliases, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        params.business_id,
        params.name,
        params.role || 'customer',
        params.aliases || [],
        params.phone || null,
      ]
    );
    return result.rows[0];
  }

  async addAlias(id: string, alias: string): Promise<void> {
    await query(
      `UPDATE contacts SET aliases = array_append(aliases, $2), updated_at = NOW()
       WHERE id = $1 AND NOT ($2 = ANY(aliases))`,
      [id, alias]
    );
  }

  async updatePaymentPattern(id: string, pattern: Contact['payment_pattern']): Promise<void> {
    await query(
      'UPDATE contacts SET payment_pattern = $2, updated_at = NOW() WHERE id = $1',
      [id, JSON.stringify(pattern)]
    );
  }

  async getRecentContacts(businessId: string, limit: number = 10): Promise<Contact[]> {
    const result = await query<Contact>(
      'SELECT * FROM contacts WHERE business_id = $1 ORDER BY updated_at DESC LIMIT $2',
      [businessId, limit]
    );
    return result.rows;
  }
}
