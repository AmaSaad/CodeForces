import { describe, it, expect } from 'vitest';
import { parseRelativeDate, formatDate, isToday } from '../src/utils/date.js';

describe('parseRelativeDate', () => {
  it('parses "yesterday" in English', () => {
    const result = parseRelativeDate('yesterday');
    expect(result).not.toBeNull();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(result!.toDateString()).toBe(yesterday.toDateString());
  });

  it('parses "امبارح" (yesterday in Arabic)', () => {
    const result = parseRelativeDate('امبارح');
    expect(result).not.toBeNull();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(result!.toDateString()).toBe(yesterday.toDateString());
  });

  it('parses "3 days ago"', () => {
    const result = parseRelativeDate('3 days ago');
    expect(result).not.toBeNull();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(result!.toDateString()).toBe(threeDaysAgo.toDateString());
  });

  it('parses "today"', () => {
    const result = parseRelativeDate('today');
    expect(result).not.toBeNull();
    expect(result!.toDateString()).toBe(new Date().toDateString());
  });

  it('returns null for non-date text', () => {
    expect(parseRelativeDate('hello')).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats dates in human-readable form', () => {
    const date = new Date('2025-03-15');
    const result = formatDate(date);
    expect(result).toContain('15');
    expect(result).toContain('Mar');
    expect(result).toContain('2025');
  });
});

describe('isToday', () => {
  it('returns true for today', () => {
    expect(isToday(new Date())).toBe(true);
  });

  it('returns false for yesterday', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isToday(yesterday)).toBe(false);
  });
});
