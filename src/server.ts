import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool, toDatabase } from './database/pool.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = toDatabase(createPool(env));
  const app = buildApp({ db }, { logLevel: env.LOG_LEVEL });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.close();
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
