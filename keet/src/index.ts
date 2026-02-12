import { config } from './config.js';
import { KeetAgent } from './engine/agent.js';
import { TelegramChannel } from './channels/telegram.js';

async function main() {
  console.log('Starting Keet...');
  console.log(`Environment: ${config.app.env}`);

  // Validate required config
  if (!config.telegram.botToken) {
    console.error('TELEGRAM_BOT_TOKEN is required');
    process.exit(1);
  }

  if (!config.llm.openaiApiKey) {
    console.warn('OPENAI_API_KEY not set — LLM parsing will fall back to regex only');
  }

  // Initialize the agent
  const agent = new KeetAgent();

  // Initialize Telegram channel
  const telegram = new TelegramChannel(agent);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    await telegram.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the bot
  await telegram.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
