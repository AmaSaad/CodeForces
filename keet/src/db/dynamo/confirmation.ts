import { v4 as uuid } from 'uuid';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TABLE_NAME } from './client.js';
import { keys, prefixes } from './keys.js';

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
  private doc = getDocClient();

  async create(params: {
    business_id: string;
    channel: string;
    channel_user_id: string;
    confirmation_type: string;
    data: any;
  }): Promise<PendingConfirmation> {
    const id = uuid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

    const item = {
      ...keys.confirmation(params.channel, params.channel_user_id, id),
      id,
      business_id: params.business_id,
      channel: params.channel,
      channel_user_id: params.channel_user_id,
      confirmation_type: params.confirmation_type,
      data: params.data,
      resolved: false,
      created_at: now.toISOString(),
      expiresAt: Math.floor(expiresAt.getTime() / 1000), // DynamoDB TTL (epoch seconds)
    };

    await this.doc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

    return {
      id,
      business_id: params.business_id,
      channel: params.channel,
      channel_user_id: params.channel_user_id,
      confirmation_type: params.confirmation_type,
      data: params.data,
      expires_at: expiresAt,
      resolved: false,
      created_at: now,
    };
  }

  async getLatestPending(channel: string, channelUserId: string): Promise<PendingConfirmation | null> {
    const p = prefixes.confirmations(channel, channelUserId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'resolved = :f',
      ExpressionAttributeValues: {
        ':pk': p.PK,
        ':f': false,
      },
      ScanIndexForward: false,
      Limit: 5,
    }));

    const now = Date.now() / 1000;
    const pending = Items.find((i) => !i.resolved && (i.expiresAt || Infinity) > now);
    if (!pending) return null;

    return {
      id: pending.id,
      business_id: pending.business_id,
      channel: pending.channel,
      channel_user_id: pending.channel_user_id,
      confirmation_type: pending.confirmation_type,
      data: pending.data,
      expires_at: new Date((pending.expiresAt || 0) * 1000),
      resolved: false,
      created_at: new Date(pending.created_at),
    };
  }

  async resolve(id: string, channel?: string, channelUserId?: string): Promise<void> {
    if (!channel || !channelUserId) return;
    await this.doc.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.confirmation(channel, channelUserId, id),
      UpdateExpression: 'SET resolved = :t',
      ExpressionAttributeValues: { ':t': true },
    }));
  }

  async resolveAllForUser(channel: string, channelUserId: string): Promise<void> {
    const p = prefixes.confirmations(channel, channelUserId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'resolved = :f',
      ExpressionAttributeValues: { ':pk': p.PK, ':f': false },
    }));

    for (const item of Items) {
      await this.resolve(item.id, channel, channelUserId);
    }
  }
}
