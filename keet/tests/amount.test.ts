import { describe, it, expect } from 'vitest';
import { parseAmount, normalizeNumerals, formatAmount } from '../src/utils/amount.js';

describe('normalizeNumerals', () => {
  it('converts Arabic-Indic numerals to Western', () => {
    expect(normalizeNumerals('٥٠')).toBe('50');
    expect(normalizeNumerals('١٢٣٤٥')).toBe('12345');
    expect(normalizeNumerals('٠')).toBe('0');
  });

  it('leaves Western numerals unchanged', () => {
    expect(normalizeNumerals('12345')).toBe('12345');
  });

  it('handles mixed numerals', () => {
    expect(normalizeNumerals('٥0 bags')).toBe('50 bags');
  });
});

describe('parseAmount', () => {
  it('parses plain numbers', () => {
    expect(parseAmount('5000')).toBe(5000);
    expect(parseAmount('12500')).toBe(12500);
  });

  it('parses comma-separated numbers', () => {
    expect(parseAmount('12,500')).toBe(12500);
    expect(parseAmount('1,000,000')).toBe(1000000);
  });

  it('parses "k" shorthand', () => {
    expect(parseAmount('5k')).toBe(5000);
    expect(parseAmount('5K')).toBe(5000);
    expect(parseAmount('12.5k')).toBe(12500);
  });

  it('parses "thousand" in English', () => {
    expect(parseAmount('5 thousand')).toBe(5000);
  });

  it('parses Arabic-Indic numerals', () => {
    expect(parseAmount('٥٠٠٠')).toBe(5000);
    expect(parseAmount('١٢٥٠٠')).toBe(12500);
  });

  it('parses Arabic thousands', () => {
    expect(parseAmount('٥ ألف')).toBe(5000);
    expect(parseAmount('5 ألف')).toBe(5000);
  });

  it('strips currency symbols', () => {
    expect(parseAmount('EGP 5000')).toBe(5000);
    expect(parseAmount('$5000')).toBe(5000);
    expect(parseAmount('5000 جنيه')).toBe(5000);
  });

  it('returns null for non-numeric text', () => {
    expect(parseAmount('hello')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('parses decimal amounts', () => {
    expect(parseAmount('99.50')).toBe(99.5);
  });
});

describe('formatAmount', () => {
  it('formats with currency', () => {
    expect(formatAmount(12500, 'EGP')).toBe('EGP 12,500');
    expect(formatAmount(1000000, 'SAR')).toBe('SAR 1,000,000');
  });

  it('handles decimals', () => {
    expect(formatAmount(99.5, 'EGP')).toBe('EGP 99.5');
  });

  it('handles zero', () => {
    expect(formatAmount(0, 'EGP')).toBe('EGP 0');
  });
});
