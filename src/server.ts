import { buildApp } from './app.js';
import { createIngestionRunner } from './modules/ingestion/service.js';
import { createTokenVerifier } from './shared/auth/jwt.js';
import { createRedisCache } from './shared/cache/client.js';
import { authConfig, loadEnv } from './shared/config/env.js';
import { createPool, toDatabase } from './shared/database/pool.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env);
  const db = toDatabase(pool);
  const { cache, close: closeCache } = createRedisCache(env, (event, data) =>
    console.warn(JSON.stringify({ event, ...data })),
  );
  const auth = authConfig(env);

  // El runner registra en el logger de la app; la closure solo se invoca durante un
  // request, cuando `app` ya existe.
  const ingestion = createIngestionRunner(pool, {
    log: (msg, data) => app.log.info(data ?? {}, msg),
  });

  const app = buildApp(
    {
      db,
      cache,
      cacheTtl: { list: env.CACHE_TTL_LIST_SECONDS, detail: env.CACHE_TTL_DETAIL_SECONDS },
      ingestion,
      ...(auth ? { verifyToken: createTokenVerifier(auth) } : {}),
    },
    {
      logLevel: env.LOG_LEVEL,
      docs: env.DOCS_ENABLED,
      trustProxy: env.TRUST_PROXY,
      rateLimit: env.RATE_LIMIT_ENABLED
        ? { max: env.RATE_LIMIT_MAX, windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS }
        : false,
    },
  );
  if (!auth) {
    app.log.warn('auth not configured (AUTH_JWKS_URL / AUTH_JWT_SECRET): admin endpoints will reject every request');
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close(); // espera corridas de ingesta en curso (hook onClose)
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
