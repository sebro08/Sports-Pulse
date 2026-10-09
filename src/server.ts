import { buildApp } from './app.js';
import { createRedisCache } from './shared/cache/client.js';
import { loadEnv } from './shared/config/env.js';
import { createPool, toDatabase } from './shared/database/pool.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = toDatabase(createPool(env));
  const { cache, close: closeCache } = createRedisCache(env, (event, data) =>
    console.warn(JSON.stringify({ event, ...data })),
  );
  const app = buildApp(
    {
      db,
      cache,
      cacheTtl: { list: env.CACHE_TTL_LIST_SECONDS, detail: env.CACHE_TTL_DETAIL_SECONDS },
    },
    { logLevel: env.LOG_LEVEL, docs: env.DOCS_ENABLED },
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.close();
    await closeCache();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
