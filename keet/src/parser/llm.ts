import OpenAI from 'openai';
import { config } from '../config.js';
import type { ParsedIntent, BusinessContext } from '../types.js';

const openai = new OpenAI({ apiKey: config.llm.openaiApiKey });

const SYSTEM_PROMPT = `You are a business transaction parser for a small business accounting assistant called Keet.
Your job is to extract structured data from informal business messages in Arabic, English, or mixed.

You MUST respond with valid JSON matching this schema:
{
  "type": "transaction" | "query" | "correction" | "business_context" | "social" | "unknown",
  "confidence": 0.0-1.0,
  "transaction_type": "sale" | "purchase" | "payment_received" | "payment_made" | "expense" | "return" | "salary" | null,
  "query_type": "receivables" | "daily_sales" | "balance" | "stock" | "contact_info" | null,
  "entities": {
    "contact": { "name": "string", "confidence": 0.0-1.0 } | null,
    "items": [{ "name": "string", "quantity": number, "price": number | null, "unit": "string" | null }] | null,
    "amount": number | null,
    "amount_paid": number | null,
    "payment_method": "cash" | "credit" | "partial" | null,
    "date": "ISO date string" | null,
    "category": "string" | null,
    "description": "string" | null
  },
  "correction": {
    "field": "string",
    "old_value": any,
    "new_value": any
  } | null
}

Rules:
- Arabic-Indic numerals (٠-٩) should be converted to Western (0-9)
- "بالآجل" / "آجل" / "بالاجل" = credit
- "كاش" / "نقدي" / "cash" = cash
- "اخد" / "أخذ" / "took" with no explicit payment = credit
- If someone "took" goods with no payment mentioned, it's a credit sale
- If partial payment: payment_method = "partial", amount = total, amount_paid = what was paid
- "5k" = 5000, "٥ ألف" = 5000
- Dates: "yesterday" = yesterday's date, "امبارح" = yesterday, no date = today
- For queries: detect what the user is asking about (receivables, daily sales, etc.)
- For corrections: identify what field changed and the old/new values
- "who owes me" / "مين عليه فلوس" = receivables query
- "how much did I sell today" = daily_sales query
- Social messages (greetings, thanks) → type: "social"

Be generous with confidence. If you're >60% sure of the intent, parse it.`;

function buildContextPrompt(context: BusinessContext): string {
  const parts: string[] = [];

  parts.push(`Business: ${context.business.business_type || 'unknown'}, Currency: ${context.business.currency}`);

  if (context.recent_contacts.length > 0) {
    const names = context.recent_contacts.map((c) =>
      `${c.name}${c.aliases.length > 0 ? ` (aka ${c.aliases.join(', ')})` : ''} [${c.role}]`
    );
    parts.push(`Known contacts: ${names.join('; ')}`);
  }

  if (context.recent_items.length > 0) {
    const items = context.recent_items.map((i) =>
      `${i.name}${i.current_price ? ` @${i.current_price}/${i.unit || 'unit'}` : ''}`
    );
    parts.push(`Known items: ${items.join('; ')}`);
  }

  return parts.join('\n');
}

export async function llmParse(message: string, context: BusinessContext): Promise<ParsedIntent> {
  const contextPrompt = buildContextPrompt(context);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Business context:\n${contextPrompt}\n\nMessage to parse:\n"${message}"`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty LLM response');
  }

  const parsed = JSON.parse(content);

  // Validate and normalize the response
  const intent: ParsedIntent = {
    type: parsed.type || 'unknown',
    confidence: Math.min(1, Math.max(0, parsed.confidence || 0)),
    transaction_type: parsed.transaction_type || undefined,
    query_type: parsed.query_type || undefined,
    entities: {
      contact: parsed.entities?.contact || undefined,
      items: parsed.entities?.items || undefined,
      amount: parsed.entities?.amount != null ? Number(parsed.entities.amount) : undefined,
      amount_paid: parsed.entities?.amount_paid != null ? Number(parsed.entities.amount_paid) : undefined,
      payment_method: parsed.entities?.payment_method || undefined,
      date: parsed.entities?.date ? new Date(parsed.entities.date) : undefined,
      category: parsed.entities?.category || undefined,
      description: parsed.entities?.description || undefined,
    },
    correction: parsed.correction || undefined,
    raw_llm_response: parsed,
  };

  return intent;
}
