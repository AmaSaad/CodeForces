import { v4 as uuid } from 'uuid';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TABLE_NAME } from './client.js';
import { keys, prefixes } from './keys.js';
import { normalizeArabic } from '../../utils/arabic.js';
import type { Item } from '../../types.js';

export class ItemRepository {
  private doc = getDocClient();

  async findByName(businessId: string, name: string): Promise<Item | null> {
    const normalized = name.toLowerCase().trim();

    const { Item: lookup } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.itemName(businessId, normalized),
    }));

    if (lookup?.itemId) {
      return this.findById(businessId, lookup.itemId);
    }

    // Try Arabic-normalized
    const arabicNorm = normalizeArabic(normalized);
    if (arabicNorm !== normalized) {
      const { Item: arLookup } = await this.doc.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: keys.itemName(businessId, arabicNorm),
      }));
      if (arLookup?.itemId) {
        return this.findById(businessId, arLookup.itemId);
      }
    }

    return null;
  }

  async findById(businessId: string, itemId: string): Promise<Item | null> {
    const { Item } = await this.doc.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.item(businessId, itemId),
    }));
    if (!Item) return null;
    return this.toItem(Item);
  }

  async findByBusiness(businessId: string): Promise<Item[]> {
    const p = prefixes.items(businessId);
    const { Items = [] } = await this.doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': p.PK,
        ':prefix': p.SKprefix,
      },
    }));
    return Items.map((i) => this.toItem(i));
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
    const now = new Date().toISOString();
    const nameLower = params.name.toLowerCase().trim();

    const itemData = {
      ...keys.item(params.business_id, id),
      id,
      business_id: params.business_id,
      name: params.name,
      aliases: params.aliases || [],
      category: params.category || null,
      unit: params.unit || null,
      current_price: params.current_price || null,
      current_stock: null,
      created_at: now,
      updated_at: now,
    };

    const nameLookup = {
      ...keys.itemName(params.business_id, nameLower),
      itemId: id,
    };

    const transactItems: any[] = [
      { Put: { TableName: TABLE_NAME, Item: itemData } },
      { Put: { TableName: TABLE_NAME, Item: nameLookup } },
    ];

    // Arabic-normalized alias
    const arabicNorm = normalizeArabic(nameLower);
    if (arabicNorm !== nameLower) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: { ...keys.itemName(params.business_id, arabicNorm), itemId: id },
        },
      });
    }

    await this.doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return this.toItem(itemData);
  }

  async updatePrice(id: string, price: number): Promise<void> {
    // We need the business_id to construct the key. Extract from id lookup.
    // Since callers always have the item object, we'll accept businessId.
    // For now, scan is avoided by passing business_id through the engine.
    // This is a known trade-off: the engine must pass business_id.
    // See updatePriceForBiz below.
  }

  async updatePriceForBiz(businessId: string, id: string, price: number): Promise<void> {
    await this.doc.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.item(businessId, id),
      UpdateExpression: 'SET current_price = :price, updated_at = :now',
      ExpressionAttributeValues: {
        ':price': price,
        ':now': new Date().toISOString(),
      },
    }));
  }

  async updateStock(businessId: string, id: string, stockChange: number): Promise<void> {
    await this.doc.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.item(businessId, id),
      UpdateExpression: 'SET current_stock = if_not_exists(current_stock, :zero) + :change, updated_at = :now',
      ExpressionAttributeValues: {
        ':change': stockChange,
        ':zero': 0,
        ':now': new Date().toISOString(),
      },
    }));
  }

  async addAlias(businessId: string, id: string, alias: string): Promise<void> {
    const aliasLower = alias.toLowerCase().trim();
    await this.doc.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: keys.item(businessId, id),
            UpdateExpression: 'SET aliases = list_append(if_not_exists(aliases, :empty), :alias)',
            ExpressionAttributeValues: { ':alias': [alias], ':empty': [] },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: { ...keys.itemName(businessId, aliasLower), itemId: id },
          },
        },
      ],
    }));
  }

  async getRecentItems(businessId: string, limit: number = 10): Promise<Item[]> {
    const all = await this.findByBusiness(businessId);
    return all
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
      .slice(0, limit);
  }

  private toItem(item: Record<string, any>): Item {
    return {
      id: item.id,
      business_id: item.business_id,
      name: item.name,
      aliases: item.aliases || [],
      category: item.category || null,
      unit: item.unit || null,
      current_price: item.current_price !== undefined ? Number(item.current_price) : null,
      current_stock: item.current_stock !== undefined ? Number(item.current_stock) : null,
      created_at: new Date(item.created_at),
      updated_at: new Date(item.updated_at),
    };
  }
}
