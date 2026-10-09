import pg from 'pg';
import type { QueryResultRow } from 'pg';
import type { Env } from '../config/env.js';
import type { Queryable } from './queryable.js';

// bigint (int8) llega como string por defecto. Los ids y conteos de este proyecto
// caben de sobra en 2^53, asi que se parsean como number (tipos y JSON consistentes).
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export interface Database extends Queryable {
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
    query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
      return pool.query<R>(text, values);
    },
  };
}
