-- Keet Initial Schema
-- All financial data is append-only. Corrections create new entries, never modify existing ones.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Businesses ───
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  owner_name VARCHAR(255),
  business_type VARCHAR(255),
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  timezone VARCHAR(50) NOT NULL DEFAULT 'Africa/Cairo',
  language_preference VARCHAR(10) NOT NULL DEFAULT 'ar' CHECK (language_preference IN ('ar', 'en', 'mixed')),
  settings JSONB NOT NULL DEFAULT '{}',
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_businesses_phone ON businesses(phone_number);

-- ─── Contacts ───
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'supplier', 'employee')),
  phone VARCHAR(20),
  default_payment_terms INTEGER,
  default_items TEXT[] NOT NULL DEFAULT '{}',
  payment_pattern JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_business ON contacts(business_id);
CREATE INDEX idx_contacts_name ON contacts(business_id, name);

-- ─── Items ───
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  category VARCHAR(100),
  unit VARCHAR(50),
  current_price NUMERIC(12, 2),
  current_stock NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_business ON items(business_id);
CREATE INDEX idx_items_name ON items(business_id, name);

-- ─── Item Price History ───
CREATE TABLE item_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price NUMERIC(12, 2) NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(20) NOT NULL DEFAULT 'transaction' CHECK (source IN ('transaction', 'manual'))
);

CREATE INDEX idx_price_history_item ON item_price_history(item_id, date DESC);

-- ─── Transactions (append-only ledger) ───
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('sale', 'purchase', 'payment_received', 'payment_made', 'expense', 'return', 'salary')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  items JSONB NOT NULL DEFAULT '[]',
  total_amount NUMERIC(12, 2) NOT NULL,
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'credit', 'partial')),
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  category VARCHAR(100),
  description TEXT,
  original_message TEXT NOT NULL,
  parsed_confidence NUMERIC(3, 2) NOT NULL DEFAULT 0,
  source_channel VARCHAR(20) NOT NULL DEFAULT 'telegram' CHECK (source_channel IN ('telegram', 'whatsapp', 'web')),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_business ON transactions(business_id, transaction_date DESC);
CREATE INDEX idx_transactions_contact ON transactions(contact_id);
CREATE INDEX idx_transactions_type ON transactions(business_id, type);
CREATE INDEX idx_transactions_date ON transactions(business_id, transaction_date);

-- ─── Corrections (links original → corrected) ───
CREATE TABLE corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  original_transaction_id UUID NOT NULL REFERENCES transactions(id),
  corrected_transaction_id UUID NOT NULL REFERENCES transactions(id),
  correction_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_corrections_original ON corrections(original_transaction_id);

-- ─── Business Knowledge (structured memory) ───
CREATE TABLE business_knowledge (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  source_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, type, key)
);

CREATE INDEX idx_knowledge_business ON business_knowledge(business_id, type);

-- ─── Channel Identities (maps channel user IDs to businesses) ───
CREATE TABLE channel_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'web')),
  channel_user_id VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel, channel_user_id)
);

CREATE INDEX idx_channel_identities_lookup ON channel_identities(channel, channel_user_id);

-- ─── Pending Confirmations (for inline keyboard flows) ───
CREATE TABLE pending_confirmations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  channel_user_id VARCHAR(255) NOT NULL,
  confirmation_type VARCHAR(50) NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_confirmations_lookup ON pending_confirmations(channel, channel_user_id, resolved);
