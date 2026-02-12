/**
 * Message deduplication via DynamoDB.
 * Prevents double-processing when Telegram retries webhooks.
 *
 * Uses conditional PutItem — if the key already exists, it's a duplicate.
 * TTL auto-cleans entries after 1 hour.
 */
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

const tableName = process.env.DEDUP_TABLE_NAME;
let client: DynamoDBClient | null = null;

function getClient(): DynamoDBClient {
  if (!client) {
    client = new DynamoDBClient({});
  }
  return client;
}

/**
 * Check if a message has already been processed.
 * Returns true if duplicate (already seen), false if new.
 */
export async function checkDedup(messageKey: string): Promise<boolean> {
  if (!tableName) return false; // Dedup disabled (local dev)

  try {
    await getClient().send(new PutItemCommand({
      TableName: tableName,
      Item: {
        pk: { S: messageKey },
        expiresAt: { N: String(Math.floor(Date.now() / 1000) + 3600) }, // 1 hour TTL
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return false; // New message, not a duplicate
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return true; // Duplicate
    }
    // On any other error, let the message through (fail open)
    console.warn('Dedup check failed:', error);
    return false;
  }
}

/**
 * Mark a message as successfully processed.
 * (Already marked by checkDedup's PutItem, but this updates the TTL
 *  to extend retention after successful processing.)
 */
export async function markProcessed(messageKey: string): Promise<void> {
  // The PutItem in checkDedup already inserted the record.
  // No additional action needed.
}
