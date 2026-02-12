import { v4 as uuid } from 'uuid';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TABLE_NAME } from './client.js';
import { keys } from './keys.js';
import type { Business } from '../../types.js';

export class BusinessRepository {
  private doc = getDocClient();

  async findByChannelUser(channel: string, channelUserId: string): Promise<Business | null> {
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.channelIdentity(channel, channelUserId),
    }));
    if (!Item?.businessId) return null;
    return this.findById(Item.businessId);
  }

  async findById(id: string): Promise<Business | null> {
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.business(id),
    }));
    if (!Item) return null;
    return this.toBusiness(Item);
  }

  async create(params: {
    phone_number?: string;
    currency?: string;
    language_preference?: 'ar' | 'en' | 'mixed';
  }): Promise<Business> {
    const id = uuid();
    const now = new Date().toISOString();
    const item = {
      ...keys.business(id),
      id,
      phone_number: params.phone_number || '',
      owner_name: null,
      business_type: null,
      currency: params.currency || 'EGP',
      timezone: 'Africa/Cairo',
      language_preference: params.language_preference || 'ar',
      settings: {},
      onboarding_complete: false,
      created_at: now,
      updated_at: now,
    };

    await this.doc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return this.toBusiness(item);
  }

  async update(id: string, fields: Partial<Pick<Business,
    'owner_name' | 'business_type' | 'currency' | 'timezone' |
    'language_preference' | 'settings' | 'onboarding_complete'
  >>): Promise<Business> {
    const exprs: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, any> = {};

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        const attr = `#${key}`;
        const val = `:${key}`;
        exprs.push(`${attr} = ${val}`);
        names[attr] = key;
        values[val] = value;
      }
    }

    exprs.push('#updated_at = :updated_at');
    names['#updated_at'] = 'updated_at';
    values[':updated_at'] = new Date().toISOString();

    const { Attributes } = await this.doc.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.business(id),
      UpdateExpression: `SET ${exprs.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));

    return this.toBusiness(Attributes!);
  }

  async linkChannel(businessId: string, channel: string, channelUserId: string, phone?: string): Promise<void> {
    await this.doc.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...keys.channelIdentity(channel, channelUserId),
        businessId,
        phone_number: phone || null,
        created_at: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })).catch((err) => {
      // Ignore if already exists
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    });
  }

  private toBusiness(item: Record<string, any>): Business {
    return {
      id: item.id,
      phone_number: item.phone_number,
      owner_name: item.owner_name || null,
      business_type: item.business_type || null,
      currency: item.currency,
      timezone: item.timezone,
      language_preference: item.language_preference,
      settings: item.settings || {},
      onboarding_complete: item.onboarding_complete || false,
      created_at: new Date(item.created_at),
      updated_at: new Date(item.updated_at),
    };
  }
}
