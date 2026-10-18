import { parseArgs } from 'node:util';
import { z } from 'zod';
import { bumpDatasetVersion } from '../../shared/cache/dataset-version.js';
import { createRedisCache } from '../../shared/cache/client.js';
import { loadEnv } from '../../shared/config/env.js';
import { createPool } from '../../shared/database/pool.js';
import { fetchJson } from './http.js';
import { changedData, ingestStatsBomb } from './service.js';
import { competitionsUrl } from './sources/statsbomb/client.js';
import { competitionEntrySchema } from './sources/statsbomb/schemas.js';
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
  const env = loadEnv();
  const pool = createPool(env);
  const log = (msg: string, data?: Record<string, unknown>) =>
    console.log(JSON.stringify({ msg, ...data }));
  try {
    const result = await ingestStatsBomb(
      pool,
      {
        competitionId,
        seasonId,
        triggeredBy: 'cli',
        ...(values.key ? { idempotencyKey: values.key } : {}),
      },
      { log },
    );
    console.log(JSON.stringify(result, null, 2));
    if (changedData(result)) {
      // Igual que el endpoint HTTP: si hubo datos nuevos, invalida el cache del catalogo.
      const { cache, close } = createRedisCache(env);
      const version = await bumpDatasetVersion(cache);
      await close();
      log(version === undefined ? 'cache not invalidated (redis unavailable, TTL applies)' : 'catalog cache invalidated', { datasetVersion: version });
    }
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
