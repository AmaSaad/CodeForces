// ─── Database Models ───

export interface Business {
  id: string;
  phone_number: string;
  owner_name: string | null;
  business_type: string | null;
  currency: string;
  timezone: string;
  language_preference: 'ar' | 'en' | 'mixed';
  settings: BusinessSettings;
  onboarding_complete: boolean;
  onboarding_step?: string;
  created_at: Date;
  updated_at: Date;
}

export interface BusinessSettings {
  summary_time?: string;
  quiet_hours?: { start: string; end: string };
  high_value_threshold?: number;
}

export interface Contact {
  id: string;
  business_id: string;
  name: string;
  aliases: string[];
  role: 'customer' | 'supplier' | 'employee';
  phone: string | null;
  default_payment_terms: number | null;
  default_items: string[];
  payment_pattern: PaymentPattern | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentPattern {
  average_days: number;
  longest_delay: number;
  total_transactions: number;
}

export interface Item {
  id: string;
  business_id: string;
  name: string;
  aliases: string[];
  category: string | null;
  unit: string | null;
  current_price: number | null;
  current_stock: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ItemPriceHistory {
  id: string;
  item_id: string;
  price: number;
  date: Date;
  source: 'transaction' | 'manual';
}

export interface Transaction {
  id: string;
  business_id: string;
  type: TransactionType;
  contact_id: string | null;
  items: TransactionItem[];
  total_amount: number;
  amount_paid: number;
  payment_method: 'cash' | 'credit' | 'partial';
  is_personal: boolean;
  category: string | null;
  description: string | null;
  original_message: string;
  parsed_confidence: number;
  source_channel: 'telegram' | 'whatsapp' | 'web';
  transaction_date: Date;
  voided: boolean;
  created_at: Date;
  updated_at: Date;
}

export type TransactionType =
  | 'sale'
  | 'purchase'
  | 'payment_received'
  | 'payment_made'
  | 'expense'
  | 'return'
  | 'salary';

export interface TransactionItem {
  item_id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Correction {
  id: string;
  business_id: string;
  original_transaction_id: string;
  corrected_transaction_id: string;
  correction_message: string;
  created_at: Date;
}

export interface BusinessKnowledge {
  id: string;
  business_id: string;
  type: string;
  key: string;
  value: any;
  source_message: string | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Message Pipeline Types ───

export interface IncomingMessage {
  channel: 'telegram' | 'whatsapp' | 'web';
  channel_user_id: string;
  phone_number?: string;
  message_text: string;
  message_id: string;
  timestamp: Date;
  language?: string;
}

export interface ParsedIntent {
  type: 'transaction' | 'query' | 'correction' | 'business_context' | 'onboarding_response' | 'social' | 'unknown';
  confidence: number;
  transaction_type?: TransactionType;
  entities: ParsedEntities;
  query_type?: 'receivables' | 'daily_sales' | 'balance' | 'stock' | 'contact_info';
  correction?: {
    field: string;
    old_value: any;
    new_value: any;
  };
  raw_llm_response?: any;
}

export interface ParsedEntities {
  contact?: { name: string; confidence: number };
  items?: Array<{ name: string; quantity: number; price?: number; unit?: string }>;
  amount?: number;
  amount_paid?: number;
  payment_method?: 'cash' | 'credit' | 'partial';
  date?: Date;
  category?: string;
  description?: string;
}

export interface AgentResponse {
  message_text: string;
  requires_confirmation?: boolean;
  confirmation_data?: any;
  inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>;
}

// ─── Business Context for LLM ───

export interface BusinessContext {
  business: Business;
  recent_contacts: Contact[];
  recent_items: Item[];
  recent_transactions: Transaction[];
}

// ─── Receivable Summary ───

export interface ReceivableSummary {
  contacts: Array<{
    contact_id: string;
    name: string;
    amount: number;
    days_outstanding: number;
    oldest_transaction_date: Date;
  }>;
  total: number;
}

export interface DailySummary {
  date: Date;
  total_sales: number;
  sales_count: number;
  cash_sales: number;
  credit_sales: number;
  payments_received: number;
  expenses: number;
  new_credit_given: number;
}
