import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { createPool } from '../database/pool.js';
import { fetchJson } from './http.js';
import { ingestStatsBomb } from './service.js';
import { competitionsUrl } from './statsbomb/client.js';
import { competitionEntrySchema } from './statsbomb/schemas.js';
import { parseRecords } from './validation.js';

const id = z.coerce.number().int().positive();

const { values } = parseArgs({
  options: {
    list: { type: 'boolean', default: false },
    competition: { type: 'string', default: '43' },
    season: { type: 'string', default: '3' },
    key: { type: 'string' },
  },
});

async function main(): Promise<number> {
  if (values.list) {
    const catalog = await fetchJson(competitionsUrl());
    if (!Array.isArray(catalog)) throw new Error('unexpected catalog format');
    const { valid } = parseRecords(competitionEntrySchema, catalog);
    console.table(
      valid.map((e) => ({
        competition: e.competition_id,
        season: e.season_id,
        name: e.competition_name,
        season_name: e.season_name,
      })),
    );
    return 0;
  }

  const competitionId = id.parse(values.competition);
  const seasonId = id.parse(values.season);
  const pool = createPool(loadEnv());
  try {
    const result = await ingestStatsBomb(
      pool,
      { competitionId, seasonId, ...(values.key ? { idempotencyKey: values.key } : {}) },
      { log: (msg, data) => console.log(JSON.stringify({ msg, ...data })) },
    );
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'FAILED' ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
