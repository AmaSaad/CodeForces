import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './index.js';

async function migrate() {
  const pool = getPool();

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Get already applied migrations
  const { rows: applied } = await pool.query('SELECT name FROM _migrations ORDER BY id');
  const appliedSet = new Set(applied.map((r) => r.name));

  // Read migration files
  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }

    console.log(`  → Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  ✓ ${file} applied`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} failed:`, e);
      throw e;
    } finally {
      client.release();
    }
  }

  console.log('Migrations complete.');
  await closePool();
}

migrate().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
