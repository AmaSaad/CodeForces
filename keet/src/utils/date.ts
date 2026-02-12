/**
 * Parse relative dates from natural language.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface RelativeDatePattern {
  patterns: RegExp[];
  resolve: () => Date;
}

const RELATIVE_PATTERNS: RelativeDatePattern[] = [
  {
    patterns: [/\byesterday\b/i, /امبارح/, /أمس/, /البارحة/],
    resolve: () => new Date(Date.now() - DAY_MS),
  },
  {
    patterns: [/\btoday\b/i, /النهارده?/, /اليوم/],
    resolve: () => new Date(),
  },
  {
    patterns: [/(\d+)\s*days?\s*ago/i, /من\s*(\d+)\s*(?:يوم|أيام)/],
    resolve: function () { return new Date(); }, // Placeholder, handled with match groups
  },
  {
    patterns: [/\blast\s+week\b/i, /الاسبوع\s*(?:اللي\s*)?فات/],
    resolve: () => new Date(Date.now() - 7 * DAY_MS),
  },
];

export function parseRelativeDate(text: string): Date | null {
  const normalized = text.toLowerCase();

  // "X days ago" pattern
  const daysAgoEn = normalized.match(/(\d+)\s*days?\s*ago/i);
  if (daysAgoEn) {
    return new Date(Date.now() - parseInt(daysAgoEn[1]) * DAY_MS);
  }

  const daysAgoAr = text.match(/من\s*(\d+)\s*(?:يوم|أيام)/);
  if (daysAgoAr) {
    return new Date(Date.now() - parseInt(daysAgoAr[1]) * DAY_MS);
  }

  // Static patterns
  for (const { patterns, resolve } of RELATIVE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return resolve();
      }
    }
  }

  // Try parsing as a date string
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function isToday(date: Date): boolean {
  const now = new Date();
  return date.toDateString() === now.toDateString();
}
