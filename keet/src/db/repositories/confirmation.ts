import { v4 as uuid } from 'uuid';
import { query } from '../index.js';

export interface PendingConfirmation {
  id: string;
  business_id: string;
  channel: string;
  channel_user_id: string;
  confirmation_type: string;
  data: any;
  expires_at: Date;
  resolved: boolean;
  created_at: Date;
}

export class ConfirmationRepository {
  async create(params: {
    business_id: string;
    channel: string;
    channel_user_id: string;
    confirmation_type: string;
    data: any;
  }): Promise<PendingConfirmation> {
    const id = uuid();
    const result = await query<PendingConfirmation>(
      `INSERT INTO pending_confirmations (id, business_id, channel, channel_user_id, confirmation_type, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, params.business_id, params.channel, params.channel_user_id, params.confirmation_type, JSON.stringify(params.data)]
    );
    return result.rows[0];
  }

  async getLatestPending(channel: string, channelUserId: string): Promise<PendingConfirmation | null> {
    const result = await query<PendingConfirmation>(
      `SELECT * FROM pending_confirmations
       WHERE channel = $1 AND channel_user_id = $2 AND resolved = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [channel, channelUserId]
    );
    return result.rows[0] || null;
  }

  async resolve(id: string): Promise<void> {
    await query(
      'UPDATE pending_confirmations SET resolved = TRUE WHERE id = $1',
      [id]
    );
  }

  async resolveAllForUser(channel: string, channelUserId: string): Promise<void> {
    await query(
      `UPDATE pending_confirmations SET resolved = TRUE
       WHERE channel = $1 AND channel_user_id = $2 AND resolved = FALSE`,
      [channel, channelUserId]
    );
  }
}
