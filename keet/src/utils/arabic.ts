/**
 * Arabic text utilities for normalization and language detection.
 */

// Normalize common Arabic variations
export function normalizeArabic(text: string): string {
  return text
    // Normalize alef variations
    .replace(/[أإآا]/g, 'ا')
    // Normalize taa marbuta
    .replace(/ة/g, 'ه')
    // Remove tashkeel (diacritics)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize ya
    .replace(/ى/g, 'ي')
    .trim();
}

// Detect if text is primarily Arabic
export function isArabic(text: string): boolean {
  const arabicChars = text.match(/[\u0600-\u06FF\u0750-\u077F]/g);
  const totalAlpha = text.match(/[a-zA-Z\u0600-\u06FF\u0750-\u077F]/g);

  if (!totalAlpha || totalAlpha.length === 0) return false;
  if (!arabicChars) return false;

  return arabicChars.length / totalAlpha.length > 0.5;
}

// Detect language of message
export function detectLanguage(text: string): 'ar' | 'en' | 'mixed' {
  const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const total = arabicChars + latinChars;

  if (total === 0) return 'en';
  if (arabicChars === 0) return 'en';
  if (latinChars === 0) return 'ar';

  const arabicRatio = arabicChars / total;
  if (arabicRatio > 0.7) return 'ar';
  if (arabicRatio < 0.1) return 'en';
  return 'mixed';
}

// Common Arabic business terms → English mapping for LLM context
export const ARABIC_BUSINESS_TERMS: Record<string, string> = {
  'باع': 'sold',
  'اشترى': 'bought',
  'اخد': 'took',
  'أخذ': 'took',
  'دفع': 'paid',
  'بالآجل': 'on credit',
  'بالاجل': 'on credit',
  'كاش': 'cash',
  'نقدي': 'cash',
  'آجل': 'credit',
  'اجل': 'credit',
  'فلوس': 'money',
  'حساب': 'account',
  'ديون': 'debts',
  'مدين': 'debtor',
  'دائن': 'creditor',
  'ايجار': 'rent',
  'إيجار': 'rent',
  'مرتب': 'salary',
  'مرتبات': 'salaries',
  'مين': 'who',
  'عليه': 'owes',
  'مبيعات': 'sales',
  'مشتريات': 'purchases',
  'شكارة': 'bag',
  'شكاره': 'bag',
  'شكاير': 'bags',
  'اسمنت': 'cement',
  'حديد': 'iron/steel',
  'رمل': 'sand',
};
