import type { ParsedIntent, BusinessContext } from '../types.js';

export interface TransactionParser {
  parse(message: string, context: BusinessContext): Promise<ParsedIntent>;
}
