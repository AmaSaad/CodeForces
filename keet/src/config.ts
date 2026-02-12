import dotenv from 'dotenv';
import path from 'path';

// Only load .env file in local dev (Lambda sets env vars directly)
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://keet:keet@localhost:5432/keet',
  },
  llm: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  dedup: {
    tableName: process.env.DEDUP_TABLE_NAME || '',
  },
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'debug',
    isLambda: !!process.env.AWS_LAMBDA_FUNCTION_NAME,
  },
} as const;
