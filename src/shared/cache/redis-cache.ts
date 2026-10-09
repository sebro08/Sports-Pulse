import type { Cache, Logger } from './types.js';

/** El subconjunto de ioredis que esta clase necesita (permite probarla sin Redis real). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  ping(): Promise<unknown>;
}

/**
 * Envuelve un cliente Redis para que nunca lance: cada operacion se captura y,
 * si falla, se registra y se trata como "miss" / "no-op". Esta funcion es el
 * nucleo de la resiliencia del cache y no depende de ioredis, solo de RedisLike,
 * por eso se puede probar con un cliente falso que simula caidas.
 */
export function wrapRedis(client: RedisLike, log: Logger = () => {}): Cache {
  return {
    async get(key) {
      try {
        const value = await client.get(key);
        return value === null ? undefined : value;
      } catch (err) {
        log('cache get failed', { key, err: err instanceof Error ? err.message : String(err) });
        return undefined;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await client.set(key, value, 'EX', ttlSeconds);
      } catch (err) {
        log('cache set failed', { key, err: err instanceof Error ? err.message : String(err) });
      }
    },
    async del(key) {
      try {
        await client.del(key);
      } catch (err) {
        log('cache del failed', { key, err: err instanceof Error ? err.message : String(err) });
      }
    },
    async ping() {
      try {
        await client.ping();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Cache inerte: siempre "miss" y no guarda nada. Se usa con REDIS_ENABLED=false o en tests. */
export function nullCache(): Cache {
  return {
    async get() {
      return undefined;
    },
    async set() {},
    async del() {},
    async ping() {
      return false;
    },
  };
}
