import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://keet:keet@localhost:5432/keet',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  llm: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'debug',
  },
} as const;
