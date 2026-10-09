import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { nullCache, wrapRedis, type RedisLike } from './redis-cache.js';
import type { Cache, Logger } from './types.js';


/**
 * Crea el cliente real de Redis. IMPORTANTE: ioredis es un EventEmitter y, por
 * contrato de Node, si un EventEmitter emite 'error' sin listener, el proceso
 * se cae. Sin este `.on('error', ...)`, una caida de Redis tumbaria el servidor
 * entero en vez de degradar con elegancia. maxRetriesPerRequest:1 evita que un
 * comando se quede colgado reintentando mientras el request HTTP espera.
 */
export function createRedisCache(env: Env, log: Logger = () => {}): { cache: Cache; close: () => Promise<void> } {
  if (!env.REDIS_ENABLED) return { cache: nullCache(), close: async () => {} };
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
  }) as unknown as RedisLike & { quit(): Promise<unknown>; on(event: string, cb: (err: Error) => void): void };

  client.on('error', (err: Error) => log('redis connection error', { err: err.message }));

  return {
    cache: wrapRedis(client, log),
    close: async () => {
      await client.quit().catch(() => {});
    },
  };
}
