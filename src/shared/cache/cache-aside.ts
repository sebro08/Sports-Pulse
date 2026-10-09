import type { Cache, Logger } from './types.js';

/**
 * Patron cache-aside: intenta leer de cache; si no hay dato (o el cache fallo),
 * calcula el valor real y lo guarda para la proxima vez. `load` solo se llama
 * en caso de miss, y un fallo de cache.get/set nunca impide responder: en el
 * peor caso, se pierde la ganancia de velocidad, no la disponibilidad.
 */
export async function cached<T>(
  cache: Cache,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  log: Logger = () => {},
): Promise<T> {
  let hit: string | undefined;
  try {
    hit = await cache.get(key);
  } catch {
    hit = undefined; // defensa adicional: cache.get no deberia lanzar, pero si lo hace, se ignora
  }

  if (hit !== undefined) {
    try {
      log('cache hit', { key });
      return JSON.parse(hit) as T;
    } catch {
      log('cache value corrupted, recomputing', { key });
    }
  } else {
    log('cache miss', { key });
  }

  const value = await load();
  void cache.set(key, JSON.stringify(value), ttlSeconds).catch(() => {});
  return value;
}

/** Clave estable: mismo conjunto de parametros (en cualquier orden) -> misma clave. */
export function cacheKey(prefix: string, params: Record<string, unknown>): string {
  const parts = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${String(params[k])}`);
  return `v1:${prefix}:${parts.join('&')}`;
}
