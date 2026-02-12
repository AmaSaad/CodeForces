import { describe, it, expect } from 'vitest';
import { regexParse } from '../src/parser/regex-fallback.js';

describe('regexParse - Queries', () => {
  it('detects "who owes me?" as receivables query', () => {
    const result = regexParse('who owes me?');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('query');
    expect(result!.query_type).toBe('receivables');
  });

  it('detects "مين عليه فلوس" as receivables query', () => {
    const result = regexParse('مين عليه فلوس');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('query');
    expect(result!.query_type).toBe('receivables');
  });

  it('detects "debts" as receivables query', () => {
    const result = regexParse('debts');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('query');
    expect(result!.query_type).toBe('receivables');
  });

  it('detects "ديون" as receivables query', () => {
    const result = regexParse('ديون');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('query');
    expect(result!.query_type).toBe('receivables');
  });

  it('detects "what did I sell today" as daily sales query', () => {
    const result = regexParse('what did I sell today');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('query');
    expect(result!.query_type).toBe('daily_sales');
  });

  it('detects "مبيعات النهارده" as daily sales query', () => {
    const result = regexParse('مبيعات النهارده');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('query');
    expect(result!.query_type).toBe('daily_sales');
  });
});

describe('regexParse - Transactions (English)', () => {
  it('parses "Hassan took 50 cement 10000 credit"', () => {
    const result = regexParse('Hassan took 50 cement 10000 credit');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('transaction');
    expect(result!.transaction_type).toBe('sale');
    expect(result!.entities.contact?.name).toBe('Hassan');
    expect(result!.entities.items?.[0].name).toBe('cement');
    expect(result!.entities.items?.[0].quantity).toBe(50);
    expect(result!.entities.payment_method).toBe('credit');
  });

  it('parses "sold 20 bags cement to Ahmed for 5000"', () => {
    const result = regexParse('sold 20 bags cement to Ahmed for 5000');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('transaction');
    expect(result!.transaction_type).toBe('sale');
    expect(result!.entities.contact?.name).toBe('Ahmed');
    expect(result!.entities.items?.[0].quantity).toBe(20);
    expect(result!.entities.amount).toBe(5000);
  });
});

describe('regexParse - Transactions (Arabic)', () => {
  it('parses "حسن اخد ٥٠ شكارة اسمنت"', () => {
    const result = regexParse('حسن اخد ٥٠ شكارة اسمنت');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('transaction');
    expect(result!.entities.contact?.name).toBe('حسن');
    expect(result!.entities.items?.[0].quantity).toBe(50);
  });
});

describe('regexParse - Payments', () => {
  it('parses "Hassan paid 3000"', () => {
    const result = regexParse('Hassan paid 3000');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('transaction');
    expect(result!.transaction_type).toBe('payment_received');
    expect(result!.entities.contact?.name).toBe('Hassan');
    expect(result!.entities.amount).toBe(3000);
  });

  it('parses "received 5000 from Ahmed"', () => {
    const result = regexParse('received 5000 from Ahmed');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('transaction');
    expect(result!.transaction_type).toBe('payment_received');
    expect(result!.entities.amount).toBe(5000);
  });
});

describe('regexParse - Corrections', () => {
  it('parses "no wait, it was 40 not 50"', () => {
    const result = regexParse('no wait, it was 40 not 50');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('correction');
    expect(result!.correction?.new_value).toBe(40);
    expect(result!.correction?.old_value).toBe(50);
  });

  it('parses "40 not 50"', () => {
    const result = regexParse('40 not 50');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('correction');
  });
});

describe('regexParse - Unknown', () => {
  it('returns null for unrecognized messages', () => {
    expect(regexParse('hello there')).toBeNull();
    expect(regexParse('how are you?')).toBeNull();
  });
});
