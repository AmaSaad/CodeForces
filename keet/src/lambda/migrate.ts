/**
 * CDK Custom Resource handler that runs database migrations on deploy.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const { Client } = pg;
const smClient = new SecretsManagerClient({});

export async function handler(event: any): Promise<{ PhysicalResourceId: string }> {
  console.log('Migration event:', event.RequestType);

  // Only run on Create and Update
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: event.PhysicalResourceId || 'migrations' };
  }

  // Load DB credentials
  const secretArn = process.env.DB_SECRET_ARN!;
  const cmd = new GetSecretValueCommand({ SecretId: secretArn });
  const secretResult = await smClient.send(cmd);
  const creds = JSON.parse(secretResult.SecretString!);

  const host = process.env.DATABASE_HOST || creds.host;

  const client = new Client({
    host,
    port: creds.port || 5432,
    user: creds.username,
    password: creds.password,
    database: 'keet',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get applied migrations
    const { rows: applied } = await client.query('SELECT name FROM _migrations ORDER BY id');
    const appliedSet = new Set(applied.map((r: any) => r.name));

    // Read migration files — bundled alongside this Lambda
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found, skipping');
      return { PhysicalResourceId: 'migrations' };
    }

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      console.log(`  → Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file} applied`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file} failed:`, e);
        throw e;
      }
    }

    console.log('Migrations complete.');
  } finally {
    await client.end();
  }

  return { PhysicalResourceId: 'migrations' };
}
