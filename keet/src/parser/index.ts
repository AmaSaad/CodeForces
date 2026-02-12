import type { ParsedIntent, BusinessContext } from '../types.js';
import { llmParse } from './llm.js';
import { regexParse } from './regex-fallback.js';

/**
 * Main parser that routes between LLM and regex fallback.
 * Strategy:
 * 1. Try LLM first (higher accuracy)
 * 2. Fall back to regex if LLM fails
 * 3. Return 'unknown' if both fail
 */
export class MessageParser {
  async parse(message: string, context: BusinessContext): Promise<ParsedIntent> {
    // Try LLM first
    try {
      const llmResult = await llmParse(message, context);
      if (llmResult.confidence > 0.3) {
        return llmResult;
      }
    } catch (error) {
      console.warn('LLM parse failed, falling back to regex:', (error as Error).message);
    }

    // Regex fallback
    const regexResult = regexParse(message);
    if (regexResult) {
      return regexResult;
    }

    // Unknown
    return {
      type: 'unknown',
      confidence: 0,
      entities: {},
    };
  }
}
