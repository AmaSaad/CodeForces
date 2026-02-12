import { v4 as uuid } from 'uuid';
import { query } from '../index.js';
import type { Business, BusinessSettings } from '../../types.js';

export class BusinessRepository {
  async findByPhone(phone: string): Promise<Business | null> {
    const result = await query<Business>(
      'SELECT * FROM businesses WHERE phone_number = $1',
      [phone]
    );
    return result.rows[0] || null;
  }

  async findById(id: string): Promise<Business | null> {
    const result = await query<Business>(
      'SELECT * FROM businesses WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async findByChannelUser(channel: string, channelUserId: string): Promise<Business | null> {
    const result = await query<Business>(
      `SELECT b.* FROM businesses b
       JOIN channel_identities ci ON ci.business_id = b.id
       WHERE ci.channel = $1 AND ci.channel_user_id = $2`,
      [channel, channelUserId]
    );
    return result.rows[0] || null;
  }

  async create(params: {
    phone_number?: string;
    currency?: string;
    language_preference?: 'ar' | 'en' | 'mixed';
  }): Promise<Business> {
    const id = uuid();
    const result = await query<Business>(
      `INSERT INTO businesses (id, phone_number, currency, language_preference)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, params.phone_number || '', params.currency || 'EGP', params.language_preference || 'ar']
    );
    return result.rows[0];
  }

  async update(id: string, fields: Partial<Pick<Business, 'owner_name' | 'business_type' | 'currency' | 'timezone' | 'language_preference' | 'settings' | 'onboarding_complete'>>): Promise<Business> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(key === 'settings' ? JSON.stringify(value) : value);
        paramIdx++;
      }
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query<Business>(
      `UPDATE businesses SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async linkChannel(businessId: string, channel: string, channelUserId: string, phone?: string): Promise<void> {
    await query(
      `INSERT INTO channel_identities (id, business_id, channel, channel_user_id, phone_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (channel, channel_user_id) DO NOTHING`,
      [uuid(), businessId, channel, channelUserId, phone || null]
    );
  }
}
