import { describe, it, expect } from 'vitest';
import { normalizeArabic, isArabic, detectLanguage, ARABIC_BUSINESS_TERMS } from '../src/utils/arabic.js';

describe('normalizeArabic', () => {
  it('normalizes alef variations', () => {
    expect(normalizeArabic('أحمد')).toBe('احمد');
    expect(normalizeArabic('إبراهيم')).toBe('ابراهيم');
  });

  it('normalizes taa marbuta', () => {
    expect(normalizeArabic('شكارة')).toBe('شكاره');
  });

  it('removes tashkeel', () => {
    expect(normalizeArabic('حَسَن')).toBe('حسن');
  });

  it('normalizes ya', () => {
    expect(normalizeArabic('على')).toBe('علي');
  });
});

describe('isArabic', () => {
  it('detects Arabic text', () => {
    expect(isArabic('حسن اخد ٥٠ شكارة اسمنت')).toBe(true);
    expect(isArabic('مين عليه فلوس؟')).toBe(true);
  });

  it('detects English text', () => {
    expect(isArabic('Hassan took 50 bags cement')).toBe(false);
    expect(isArabic('who owes me money?')).toBe(false);
  });

  it('returns false for pure numbers', () => {
    expect(isArabic('12345')).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('detects Arabic', () => {
    expect(detectLanguage('حسن اخد ٥٠ شكارة اسمنت بالآجل')).toBe('ar');
    expect(detectLanguage('مين عليه فلوس؟')).toBe('ar');
  });

  it('detects English', () => {
    expect(detectLanguage('Hassan took 50 bags cement')).toBe('en');
    expect(detectLanguage('who owes me money?')).toBe('en');
  });

  it('detects mixed', () => {
    expect(detectLanguage('Hassan took 50 bags cement بالآجل')).toBe('mixed');
  });

  it('defaults to English for numbers only', () => {
    expect(detectLanguage('12345')).toBe('en');
  });
});

describe('ARABIC_BUSINESS_TERMS', () => {
  it('has key Arabic business terms', () => {
    expect(ARABIC_BUSINESS_TERMS['بالآجل']).toBe('on credit');
    expect(ARABIC_BUSINESS_TERMS['كاش']).toBe('cash');
    expect(ARABIC_BUSINESS_TERMS['اخد']).toBe('took');
    expect(ARABIC_BUSINESS_TERMS['مبيعات']).toBe('sales');
  });
});
