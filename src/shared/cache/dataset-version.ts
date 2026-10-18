import type { Cache } from './types.js';

/**
 * Invalidacion por VERSION (a veces llamada "generational caching").
 *
 * En vez de buscar y borrar todas las claves afectadas por una ingesta (SCAN + DEL: caro y
 * con condiciones de carrera), cada clave del catalogo incluye la version actual del dataset:
 *     v1:d7:teams:page=1&pageSize=20
 * Cuando una ingesta cambia datos, se hace INCR de la version (7 -> 8). Desde ese instante
 * todas las lecturas construyen claves `d8:...`, que no existen -> miss -> datos frescos de
 * PostgreSQL. Las claves viejas `d7:...` nadie las vuelve a leer y Redis las borra solas
 * al vencer su TTL. Invalidar todo el catalogo cuesta UNA operacion O(1).
 *
 * La clave vive en shared/ porque la usan dos modulos que no pueden importarse entre si:
 * ingestion (escribe/sube la version) y catalog (la lee para construir sus claves).
 */
export const DATASET_VERSION_KEY = 'v1:dataset-version';

/**
 * Version actual, o `undefined` si no se pudo leer. En ese caso el que llama NO debe usar el
 * cache: si Redis tuvo un corte justo cuando se subio la version, adivinar "0" podria servir
 * datos anteriores a la ultima ingesta. Mejor ir a PostgreSQL que responder algo viejo.
 */
export async function datasetVersion(cache: Cache): Promise<number | undefined> {
  try {
    return await cache.counter(DATASET_VERSION_KEY);
  } catch {
    return undefined; // defensa adicional: el contrato dice que no lanza, pero no se confia
  }
}

/** Marca el dataset como cambiado. Devuelve la nueva version, o `undefined` si Redis fallo. */
export async function bumpDatasetVersion(cache: Cache): Promise<number | undefined> {
  try {
    return await cache.incr(DATASET_VERSION_KEY);
  } catch {
    return undefined;
  }
}
