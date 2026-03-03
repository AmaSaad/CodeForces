import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let docClient: DynamoDBDocumentClient | null = null;

export const TABLE_NAME = process.env.DYNAMODB_TABLE || 'keet';

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const isLocal = process.env.DYNAMODB_ENDPOINT !== undefined;
    const baseClient = new DynamoDBClient(
      isLocal
        ? { endpoint: process.env.DYNAMODB_ENDPOINT, region: 'local' }
        : {}
    );
    docClient = DynamoDBDocumentClient.from(baseClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}
