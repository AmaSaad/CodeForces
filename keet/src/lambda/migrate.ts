/**
 * No-op migration handler.
 * DynamoDB schema is managed by CDK (table creation) and application code (key patterns).
 * No SQL migrations needed. Kept for reference only.
 */
export async function handler(event: any): Promise<{ PhysicalResourceId: string }> {
  console.log('Migration handler (no-op for DynamoDB):', event.RequestType);
  return { PhysicalResourceId: event.PhysicalResourceId || 'migrations' };
}
