import { ItemRepository } from '../db/repositories/item.js';
import { normalizeArabic } from '../utils/arabic.js';
import type { Item } from '../types.js';

/**
 * Manages the product catalog — auto-learns items from transactions,
 * tracks prices, resolves item names.
 */
export class ItemResolver {
  constructor(private items: ItemRepository) {}

  async resolve(
    businessId: string,
    name: string,
    options?: { autoCreate?: boolean; unit?: string; price?: number }
  ): Promise<Item | null> {
    const normalizedName = name.trim();
    if (!normalizedName) return null;

    // 1. Exact match (by name or alias)
    let item = await this.items.findByName(businessId, normalizedName);

    if (item) {
      // Update price if a new one is provided
      if (options?.price && options.price !== Number(item.current_price)) {
        await this.items.updatePrice(item.id, options.price);
        item.current_price = options.price;
      }
      return item;
    }

    // 2. Normalized Arabic match
    const arabicNormalized = normalizeArabic(normalizedName);
    const allItems = await this.items.findByBusiness(businessId);
    for (const i of allItems) {
      if (normalizeArabic(i.name) === arabicNormalized) {
        if (options?.price && options.price !== Number(i.current_price)) {
          await this.items.updatePrice(i.id, options.price);
        }
        return i;
      }
      for (const alias of i.aliases) {
        if (normalizeArabic(alias) === arabicNormalized) {
          if (options?.price && options.price !== Number(i.current_price)) {
            await this.items.updatePrice(i.id, options.price);
          }
          return i;
        }
      }
    }

    // 3. Auto-create
    if (options?.autoCreate !== false) {
      return this.items.create({
        business_id: businessId,
        name: normalizedName,
        unit: options?.unit,
        current_price: options?.price,
      });
    }

    return null;
  }

  async updateStockForSale(itemId: string, quantity: number): Promise<void> {
    await this.items.updateStock(itemId, -quantity);
  }

  async updateStockForPurchase(itemId: string, quantity: number): Promise<void> {
    await this.items.updateStock(itemId, quantity);
  }
}
