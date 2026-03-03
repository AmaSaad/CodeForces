/**
 * Parse amounts from natural language including Arabic numerals,
 * shorthand (5k, 5 thousand), and mixed formats.
 */

// Arabic-Indic numerals → Western
const ARABIC_NUMERAL_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

export function normalizeNumerals(text: string): string {
  return text.replace(/[٠-٩]/g, (ch) => ARABIC_NUMERAL_MAP[ch] || ch);
}

const MULTIPLIERS: Record<string, number> = {
  'k': 1000,
  'K': 1000,
  'thousand': 1000,
  'ألف': 1000,
  'الف': 1000,
  'm': 1000000,
  'M': 1000000,
  'million': 1000000,
  'مليون': 1000000,
};

export function parseAmount(text: string): number | null {
  let normalized = normalizeNumerals(text.trim());

  // Remove currency symbols and common currency words
  normalized = normalized.replace(/(?:EGP|SAR|USD|ج\.م|جنيه|ريال|\$|£)/gi, '').trim();

  // Handle comma-separated numbers: 12,500 → 12500, 1,000,000 → 1000000
  while (/(\d),(\d{3})/.test(normalized)) {
    normalized = normalized.replace(/(\d),(\d{3})/g, '$1$2');
  }

  // Try direct number
  const directMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*$/);
  if (directMatch) {
    return parseFloat(directMatch[1]);
  }

  // Handle multiplier: "5k", "5 thousand", "٥ ألف"
  for (const [suffix, mult] of Object.entries(MULTIPLIERS)) {
    // Use word boundary for Latin suffixes, but not for Arabic
    const isArabicSuffix = /[\u0600-\u06FF]/.test(suffix);
    const boundary = isArabicSuffix ? '' : '\\b';
    const regex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${suffix}${boundary}`, 'i');
    const match = normalized.match(regex);
    if (match) {
      return parseFloat(match[1]) * mult;
    }
  }

  // Try extracting any number
  const anyNumber = normalized.match(/(\d+(?:\.\d+)?)/);
  if (anyNumber) {
    return parseFloat(anyNumber[1]);
  }

  return null;
}

export function formatAmount(amount: number, currency: string): string {
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}
