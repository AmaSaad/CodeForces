import { ContactRepository } from '../db/dynamo/contact.js';
import { normalizeArabic } from '../utils/arabic.js';
import type { Contact } from '../types.js';

/**
 * Resolves contact names from messages — handles fuzzy matching,
 * nickname resolution, and auto-creation of new contacts.
 */
export class ContactResolver {
  constructor(private contacts: ContactRepository) {}

  async resolve(
    businessId: string,
    name: string,
    options?: { autoCreate?: boolean; role?: Contact['role'] }
  ): Promise<Contact | null> {
    const normalizedName = name.trim();
    if (!normalizedName) return null;

    // 1. Exact match (by name or alias)
    let contact = await this.contacts.findByName(businessId, normalizedName);
    if (contact) return contact;

    // 2. Normalized Arabic match
    const arabicNormalized = normalizeArabic(normalizedName);
    const allContacts = await this.contacts.findByBusiness(businessId);
    for (const c of allContacts) {
      if (normalizeArabic(c.name) === arabicNormalized) return c;
      for (const alias of c.aliases) {
        if (normalizeArabic(alias) === arabicNormalized) return c;
      }
    }

    // 3. Fuzzy prefix match
    const fuzzyMatches = await this.contacts.fuzzySearch(businessId, normalizedName);
    if (fuzzyMatches.length === 1) {
      return fuzzyMatches[0];
    }

    // 4. Auto-create if requested
    if (options?.autoCreate !== false) {
      return this.contacts.create({
        business_id: businessId,
        name: normalizedName,
        role: options?.role || 'customer',
      });
    }

    return null;
  }

  async findById(businessId: string, contactId: string): Promise<Contact | null> {
    return this.contacts.findById(businessId, contactId);
  }

  async getBalance(businessId: string, contactId: string): Promise<number> {
    // Delegated to transaction repository — imported where needed
    return 0; // Placeholder, actual balance comes from TransactionRepository
  }
}
