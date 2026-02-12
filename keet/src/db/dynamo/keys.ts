/**
 * DynamoDB Single-Table Schema for Keet
 *
 * Table: keet
 * PK (String) / SK (String) / TTL: expiresAt
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Entity           │ PK                          │ SK                      │
 * ├──────────────────┼─────────────────────────────┼─────────────────────────┤
 * │ Channel Identity │ CHAN#<channel>#<userId>      │ IDENTITY                │
 * │ Business         │ BIZ#<bizId>                 │ PROFILE                 │
 * │ Contact          │ BIZ#<bizId>                 │ CONTACT#<contactId>     │
 * │ Contact Lookup   │ BIZ#<bizId>                 │ CNAME#<name_lower>      │
 * │ Item             │ BIZ#<bizId>                 │ ITEM#<itemId>           │
 * │ Item Lookup      │ BIZ#<bizId>                 │ INAME#<name_lower>      │
 * │ Transaction      │ BIZ#<bizId>                 │ TXN#<date>#<txnId>      │
 * │ Contact Txn      │ BIZ#<bizId>#C#<contactId>   │ TXN#<date>#<txnId>      │
 * │ Running Balance  │ BIZ#<bizId>                 │ BAL#<contactId>         │
 * │ Daily Summary    │ BIZ#<bizId>                 │ DAYSUM#<date>           │
 * │ Correction       │ BIZ#<bizId>                 │ CORR#<date>#<corrId>    │
 * │ Confirmation     │ CONFIRM#<channel>#<userId>  │ <confirmId>             │
 * │ Knowledge        │ BIZ#<bizId>                 │ KNOW#<type>#<key>       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Key design principles:
 * - All business data under BIZ#<id> partition → single query gets any entity type
 * - Running balances (BAL#) are pre-computed atomically with TransactWriteItems
 * - Daily summaries (DAYSUM#) are pre-computed atomically with TransactWriteItems
 * - Transaction SK includes date for natural time-ordering (newest last / query reverse)
 * - Contact transactions denormalized under BIZ#<id>#C#<contactId> for per-contact queries
 * - Name lookups (CNAME#, INAME#) are secondary items pointing to the real entity
 * - No GSI needed for v1 access patterns
 */

// ─── Key Generators ───

export const keys = {
  // Channel identity: maps telegram/whatsapp user to a business
  channelIdentity: (channel: string, userId: string) => ({
    PK: `CHAN#${channel}#${userId}`,
    SK: 'IDENTITY',
  }),

  // Business profile
  business: (bizId: string) => ({
    PK: `BIZ#${bizId}`,
    SK: 'PROFILE',
  }),

  // Contact entity
  contact: (bizId: string, contactId: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `CONTACT#${contactId}`,
  }),

  // Contact name lookup (for findByName)
  contactName: (bizId: string, name: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `CNAME#${name.toLowerCase().trim()}`,
  }),

  // Item entity
  item: (bizId: string, itemId: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `ITEM#${itemId}`,
  }),

  // Item name lookup (for findByName)
  itemName: (bizId: string, name: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `INAME#${name.toLowerCase().trim()}`,
  }),

  // Transaction (date-prefixed for time-ordering)
  transaction: (bizId: string, date: string, txnId: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `TXN#${date}#${txnId}`,
  }),

  // Contact-scoped transaction (denormalized copy)
  contactTransaction: (bizId: string, contactId: string, date: string, txnId: string) => ({
    PK: `BIZ#${bizId}#C#${contactId}`,
    SK: `TXN#${date}#${txnId}`,
  }),

  // Pre-computed running balance per contact
  balance: (bizId: string, contactId: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `BAL#${contactId}`,
  }),

  // Pre-computed daily summary
  dailySummary: (bizId: string, date: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `DAYSUM#${date}`,
  }),

  // Correction link
  correction: (bizId: string, date: string, corrId: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `CORR#${date}#${corrId}`,
  }),

  // Pending confirmation
  confirmation: (channel: string, userId: string, confirmId: string) => ({
    PK: `CONFIRM#${channel}#${userId}`,
    SK: confirmId,
  }),

  // Business knowledge
  knowledge: (bizId: string, type: string, key: string) => ({
    PK: `BIZ#${bizId}`,
    SK: `KNOW#${type}#${key}`,
  }),
} as const;

// ─── Query Prefixes ───

export const prefixes = {
  contacts: (bizId: string) => ({ PK: `BIZ#${bizId}`, SKprefix: 'CONTACT#' }),
  contactNames: (bizId: string) => ({ PK: `BIZ#${bizId}`, SKprefix: 'CNAME#' }),
  items: (bizId: string) => ({ PK: `BIZ#${bizId}`, SKprefix: 'ITEM#' }),
  transactions: (bizId: string) => ({ PK: `BIZ#${bizId}`, SKprefix: 'TXN#' }),
  balances: (bizId: string) => ({ PK: `BIZ#${bizId}`, SKprefix: 'BAL#' }),
  contactTransactions: (bizId: string, contactId: string) => ({
    PK: `BIZ#${bizId}#C#${contactId}`,
    SKprefix: 'TXN#',
  }),
  confirmations: (channel: string, userId: string) => ({
    PK: `CONFIRM#${channel}#${userId}`,
    SKprefix: '',
  }),
} as const;

// ─── Date Helpers ───

export function toDateKey(date: Date): string {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

export function toSortableTimestamp(date: Date): string {
  return date.toISOString(); // ISO 8601, sorts lexicographically
}
