import type { ParsedIntent } from '../types.js';
import { normalizeNumerals, parseAmount } from '../utils/amount.js';

/**
 * Regex-based fallback parser for common transaction patterns.
 * Used when LLM is unavailable or for cached patterns.
 * Returns lower confidence than LLM (0.3-0.6).
 */

interface PatternMatch {
  type: ParsedIntent['type'];
  transaction_type?: ParsedIntent['transaction_type'];
  entities: ParsedIntent['entities'];
  query_type?: ParsedIntent['query_type'];
}

// ─── Query Patterns ───

const QUERY_PATTERNS: Array<{ patterns: RegExp[]; query_type: ParsedIntent['query_type'] }> = [
  {
    patterns: [
      /(?:who|مين)\s*(?:owes|عليه|عليهم)\s*(?:me|فلوس)?/i,
      /debts?|ديون|المديونيات|المستحقات/i,
      /(?:outstanding|receivables)/i,
    ],
    query_type: 'receivables',
  },
  {
    patterns: [
      /(?:what|how much|ايه|كم)\s*(?:did|اللي)?\s*(?:i|أنا)?\s*(?:sell|sold|بعت|مبيعات)\s*(?:today|النهارده|اليوم)?/i,
      /(?:today'?s?|النهارده|اليوم)\s*(?:sales|مبيعات)/i,
      /(?:مبيعات|sales)\s*(?:النهارده|اليوم|today)/i,
    ],
    query_type: 'daily_sales',
  },
  {
    patterns: [
      /(?:how much|كم)\s*(?:does?|عند)\s+(\w+)\s*(?:owe|عليه|مدين)/i,
      /(?:balance|رصيد)\s+(\w+)/i,
    ],
    query_type: 'balance',
  },
  {
    patterns: [
      /(?:how much|كم)\s+(\w+)\s*(?:do i have|عندي|في المخزن)/i,
      /(?:stock|inventory|مخزون)\s*(\w+)?/i,
    ],
    query_type: 'stock',
  },
];

// ─── Transaction Patterns (English) ───

const SALE_PATTERNS_EN = [
  // "sold 20 bags cement to Hassan for 5000"
  /sold\s+(\d+)\s+(?:bags?\s+)?(\w+)\s+to\s+(\w+)\s+(?:for\s+)?(\d[\d,]*)/i,
  // "Hassan bought 50 cement 10000 credit"
  /(\w+)\s+(?:bought|took)\s+(\d+)\s+(\w+)\s*(?:for\s+)?(\d[\d,]*)?\s*(cash|credit|بالآجل|بالاجل|كاش)?/i,
];

// ─── Transaction Patterns (Arabic) ───

const SALE_PATTERNS_AR = [
  // "حسن اخد ٥٠ شكارة اسمنت"
  /(\S+)\s+(?:اخد|أخذ|خد)\s+(\d+|[٠-٩]+)\s+(?:شكار[ةه]?\s+)?(\S+)/,
  // "باع ٢٠ شكارة اسمنت لحسن"
  /باع\s+(\d+|[٠-٩]+)\s+(?:شكار[ةه]?\s+)?(\S+)\s+ل(\S+)/,
];

// Payment patterns
const PAYMENT_PATTERNS = [
  // "Hassan paid 3000" / "received 5000 from Hassan"
  /(\w+)\s+(?:paid|دفع)\s+(\d[\d,]*)/i,
  /(?:received|got|استلمت|جالي)\s+(\d[\d,]*)\s+(?:from|من)\s+(\w+)/i,
];

// Expense patterns
const EXPENSE_PATTERNS = [
  /(?:paid|دفعت)\s+(\d[\d,]*)\s+(?:for\s+)?(\w+)/i,
  /(\w+)\s+(?:expense|مصروف)\s+(\d[\d,]*)/i,
];

// Correction patterns
const CORRECTION_PATTERNS = [
  /(?:no\s*,?\s*)?(?:wait|actually|sorry)\s*,?\s*(?:it\s*(?:was|should be))\s+(\d[\d,]*)\s+(?:not|مش)\s+(\d[\d,]*)/i,
  /(?:لا|استنى)\s*,?\s*(?:كان|هو)\s+(\d[\d,]*)\s+(?:مش|مو)\s+(\d[\d,]*)/i,
  /(\d+)\s+not\s+(\d+)/i,
  /(\d+)\s+مش\s+(\d+)/i,
];

export function regexParse(message: string): ParsedIntent | null {
  const normalized = normalizeNumerals(message);

  // ─── Check Queries First ───
  for (const { patterns, query_type } of QUERY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message) || pattern.test(normalized)) {
        return {
          type: 'query',
          confidence: 0.6,
          query_type,
          entities: {},
        };
      }
    }
  }

  // ─── Check Corrections ───
  for (const pattern of CORRECTION_PATTERNS) {
    const match = normalized.match(pattern) || message.match(pattern);
    if (match) {
      return {
        type: 'correction',
        confidence: 0.5,
        entities: {},
        correction: {
          field: 'quantity_or_amount',
          new_value: parseAmount(match[1]),
          old_value: parseAmount(match[2]),
        },
      };
    }
  }

  // ─── Check Payments ───
  for (const pattern of PAYMENT_PATTERNS) {
    const match = normalized.match(pattern) || message.match(pattern);
    if (match) {
      // "Hassan paid 3000" pattern
      const isFirstPatternStyle = /paid|دفع/i.test(match[0]);
      const contactName = isFirstPatternStyle ? match[1] : match[2];
      const amount = parseAmount(isFirstPatternStyle ? match[2] : match[1]);

      if (amount) {
        return {
          type: 'transaction',
          transaction_type: 'payment_received',
          confidence: 0.4,
          entities: {
            contact: { name: contactName, confidence: 0.5 },
            amount,
            payment_method: 'cash',
          },
        };
      }
    }
  }

  // ─── Check Sales (English) ───
  for (const pattern of SALE_PATTERNS_EN) {
    const match = normalized.match(pattern);
    if (match) {
      // Try to extract entities from the match
      const isSoldPattern = /^sold/i.test(match[0]);
      let contactName: string;
      let itemName: string;
      let quantity: number;
      let amount: number | undefined;
      let paymentMethod: 'cash' | 'credit' | undefined;

      if (isSoldPattern) {
        quantity = parseInt(match[1]);
        itemName = match[2];
        contactName = match[3];
        amount = parseAmount(match[4]) || undefined;
      } else {
        contactName = match[1];
        quantity = parseInt(match[2]);
        itemName = match[3];
        amount = match[4] ? (parseAmount(match[4]) || undefined) : undefined;
        const methodStr = (match[5] || '').toLowerCase();
        if (methodStr === 'credit' || methodStr === 'بالآجل' || methodStr === 'بالاجل') {
          paymentMethod = 'credit';
        } else if (methodStr === 'cash' || methodStr === 'كاش') {
          paymentMethod = 'cash';
        }
      }

      return {
        type: 'transaction',
        transaction_type: 'sale',
        confidence: 0.4,
        entities: {
          contact: { name: contactName, confidence: 0.5 },
          items: [{ name: itemName, quantity, price: amount ? amount / quantity : undefined }],
          amount,
          payment_method: paymentMethod || (amount ? 'cash' : 'credit'),
        },
      };
    }
  }

  // ─── Check Sales (Arabic) ───
  for (const pattern of SALE_PATTERNS_AR) {
    const match = message.match(pattern);
    if (match) {
      const quantity = parseInt(normalizeNumerals(match[2] || match[1]));
      return {
        type: 'transaction',
        transaction_type: 'sale',
        confidence: 0.3,
        entities: {
          contact: { name: match[1] || match[3], confidence: 0.4 },
          items: [{ name: match[3] || match[2], quantity }],
          payment_method: /آجل|اجل|credit/i.test(message) ? 'credit' : undefined,
        },
      };
    }
  }

  // ─── Check Expenses ───
  for (const pattern of EXPENSE_PATTERNS) {
    const match = normalized.match(pattern) || message.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]) || parseAmount(match[2]);
      if (amount) {
        return {
          type: 'transaction',
          transaction_type: 'expense',
          confidence: 0.3,
          entities: {
            amount,
            category: match[2] || match[1],
          },
        };
      }
    }
  }

  return null;
}
