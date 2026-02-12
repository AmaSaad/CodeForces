import { v4 as uuid } from 'uuid';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TABLE_NAME } from './client.js';
import { keys, prefixes } from './keys.js';
import { normalizeArabic } from '../../utils/arabic.js';
import type { Contact } from '../../types.js';

export class ContactRepository {
  private doc = getDocClient();

  async findByName(businessId: string, name: string): Promise<Contact | null> {
    const normalized = name.toLowerCase().trim();

    // Direct name lookup
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.contactName(businessId, normalized),
    }));

    if (Item?.contactId) {
      return this.findById(businessId, Item.contactId);
    }

    // Try Arabic-normalized lookup
    const arabicNorm = normalizeArabic(normalized);
    if (arabicNorm !== normalized) {
      const { Item: arItem } = await this.doc.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: keys.contactName(businessId, arabicNorm),
      }));
      if (arItem?.contactId) {
        return this.findById(businessId, arItem.contactId);
      }
    }

    return null;
  }

  async fuzzySearch(businessId: string, name: string): Promise<Contact[]> {
    const prefix = name.toLowerCase().trim();
    const p = prefixes.contactNames(businessId);

    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': p.PK,
        ':prefix': `CNAME#${prefix}`,
      },
      Limit: 5,
    }));

    const contacts: Contact[] = [];
    for (const item of Items) {
      if (item.contactId) {
        const contact = await this.findById(businessId, item.contactId);
        if (contact) contacts.push(contact);
      }
    }
    return contacts;
  }

  async findById(businessId: string, contactId: string): Promise<Contact | null> {
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.contact(businessId, contactId),
    }));
    if (!Item) return null;
    return this.toContact(Item);
  }

  async findByBusiness(businessId: string): Promise<Contact[]> {
    const p = prefixes.contacts(businessId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': p.PK,
        ':prefix': p.SKprefix,
      },
    }));
    return Items.map((i) => this.toContact(i));
  }

  async create(params: {
    business_id: string;
    name: string;
    role?: 'customer' | 'supplier' | 'employee';
    aliases?: string[];
    phone?: string;
  }): Promise<Contact> {
    const id = uuid();
    const now = new Date().toISOString();
    const nameLower = params.name.toLowerCase().trim();

    const contactItem = {
      ...keys.contact(params.business_id, id),
      id,
      business_id: params.business_id,
      name: params.name,
      aliases: params.aliases || [],
      role: params.role || 'customer',
      phone: params.phone || null,
      default_payment_terms: null,
      default_items: [],
      payment_pattern: null,
      notes: null,
      created_at: now,
      updated_at: now,
    };

    const nameLookup = {
      ...keys.contactName(params.business_id, nameLower),
      contactId: id,
    };

    // Write contact + name lookup atomically
    const transactItems: any[] = [
      { Put: { TableName: TABLE_NAME, Item: contactItem } },
      { Put: { TableName: TABLE_NAME, Item: nameLookup } },
    ];

    // Also add Arabic-normalized name lookup if different
    const arabicNorm = normalizeArabic(nameLower);
    if (arabicNorm !== nameLower) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: { ...keys.contactName(params.business_id, arabicNorm), contactId: id },
        },
      });
    }

    // Add alias lookups
    for (const alias of (params.aliases || [])) {
      const aliasLower = alias.toLowerCase().trim();
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: { ...keys.contactName(params.business_id, aliasLower), contactId: id },
        },
      });
    }

    await this.doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return this.toContact(contactItem);
  }

  async addAlias(id: string, businessId: string, alias: string): Promise<void> {
    const aliasLower = alias.toLowerCase().trim();

    await this.doc.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: keys.contact(businessId, id),
            UpdateExpression: 'SET aliases = list_append(if_not_exists(aliases, :empty), :alias), updated_at = :now',
            ExpressionAttributeValues: {
              ':alias': [alias],
              ':empty': [],
              ':now': new Date().toISOString(),
            },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: { ...keys.contactName(businessId, aliasLower), contactId: id },
          },
        },
      ],
    }));
  }

  async updatePaymentPattern(id: string, businessId: string, pattern: Contact['payment_pattern']): Promise<void> {
    await this.doc.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.contact(businessId, id),
      UpdateExpression: 'SET payment_pattern = :pattern, updated_at = :now',
      ExpressionAttributeValues: {
        ':pattern': pattern,
        ':now': new Date().toISOString(),
      },
    }));
  }

  async getRecentContacts(businessId: string, limit: number = 10): Promise<Contact[]> {
    // Query all contacts, sort by updated_at in application
    const all = await this.findByBusiness(businessId);
    return all
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
      .slice(0, limit);
  }

  private toContact(item: Record<string, any>): Contact {
    return {
      id: item.id,
      business_id: item.business_id,
      name: item.name,
      aliases: item.aliases || [],
      role: item.role || 'customer',
      phone: item.phone || null,
      default_payment_terms: item.default_payment_terms || null,
      default_items: item.default_items || [],
      payment_pattern: item.payment_pattern || null,
      notes: item.notes || null,
      created_at: new Date(item.created_at),
      updated_at: new Date(item.updated_at),
    };
  }
}
