import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { createPool } from './pool.js';

/** Runner minimo: aplica migrations/*.sql en orden, cada una en una transaccion. */
async function main(): Promise<void> {
  const pool = createPool(loadEnv());
  const dir = path.resolve('migrations');
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
        (r) => r.filename,
      ),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    console.log('migrations up to date');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
