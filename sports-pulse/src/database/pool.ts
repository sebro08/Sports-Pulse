import pg from 'pg';
import type { Env } from '../config/env.js';

export interface Database {
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createPool(env: Env): pg.Pool {
  return new pg.Pool({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
}

export function toDatabase(pool: pg.Pool): Database {
  return {
    async ping() {
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },
  };
}
