import { describe, expect, it } from 'vitest';
import { cached, cacheKey } from '../../src/shared/cache/cache-aside.js';
import {
  bumpDatasetVersion,
  datasetVersion,
} from '../../src/shared/cache/dataset-version.js';
import { nullCache, wrapRedis, type RedisLike } from '../../src/shared/cache/redis-cache.js';
import { fakeCache } from '../helpers/fake-cache.js';

function brokenClient(): RedisLike {
  return {
    get: async () => {
      throw new Error('ECONNREFUSED');
    },
    set: async () => {
      throw new Error('ECONNREFUSED');
    },
    del: async () => {
      throw new Error('ECONNREFUSED');
    },
    incr: async () => {
      throw new Error('ECONNREFUSED');
    },
    ping: async () => {
      throw new Error('ECONNREFUSED');
    },
  };
}

describe('wrapRedis', () => {
  it('get() nunca lanza y devuelve undefined si el cliente falla', async () => {
    const logs: unknown[] = [];
    const cache = wrapRedis(brokenClient(), (e, d) => logs.push([e, d]));
    await expect(cache.get('x')).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it('set() y del() nunca lanzan', async () => {
    const cache = wrapRedis(brokenClient());
    await expect(cache.set('x', 'y', 60)).resolves.toBeUndefined();
    await expect(cache.del('x')).resolves.toBeUndefined();
  });

  it('ping() refleja si el cliente responde', async () => {
    expect(await wrapRedis(brokenClient()).ping()).toBe(false);
    const healthy: RedisLike = { get: async () => null, set: async () => 'OK', del: async () => 1, incr: async () => 1, ping: async () => 'PONG' };
    expect(await wrapRedis(healthy).ping()).toBe(true);
  });

  it('counter() e incr() devuelven undefined (no lanzan) si el cliente falla', async () => {
    const cache = wrapRedis(brokenClient());
    await expect(cache.counter('v')).resolves.toBeUndefined();
    await expect(cache.incr('v')).resolves.toBeUndefined();
  });

  it('counter() devuelve 0 si la clave no existe todavia', async () => {
    const client: RedisLike = { get: async () => null, set: async () => 'OK', del: async () => 1, incr: async () => 1, ping: async () => 'PONG' };
    expect(await wrapRedis(client).counter('v')).toBe(0);
  });

  it('traduce null (miss real de Redis) a undefined', async () => {
    const client: RedisLike = { get: async () => null, set: async () => 'OK', del: async () => 1, incr: async () => 1, ping: async () => 'PONG' };
    expect(await wrapRedis(client).get('k')).toBeUndefined();
  });
});

describe('nullCache', () => {
  it('siempre es miss y no persiste nada', async () => {
    const c = nullCache();
    await c.set('x', 'y', 10);
    expect(await c.get('x')).toBeUndefined();
    expect(await c.ping()).toBe(false);
  });
});

describe('cached()', () => {
  it('en miss llama a load() y guarda el resultado', async () => {
    const store = new Map<string, string>();
    const cache = {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: string) => void store.set(k, v),
      del: async () => {},
      counter: async () => 0,
      incr: async () => 1,
      ping: async () => true,
    };
    let calls = 0;
    const value = await cached(cache, 'k1', 60, async () => {
      calls++;
      return { a: 1 };
    });
    expect(value).toEqual({ a: 1 });
    expect(calls).toBe(1);
  });

  it('en hit NO llama a load()', async () => {
    const cache = {
      get: async () => JSON.stringify({ a: 'cached' }),
      set: async () => {},
      del: async () => {},
      counter: async () => 0,
      incr: async () => 1,
      ping: async () => true,
    };
    let calls = 0;
    const value = await cached(cache, 'k1', 60, async () => {
      calls++;
      return { a: 'fresh' };
    });
    expect(value).toEqual({ a: 'cached' });
    expect(calls).toBe(0);
  });

  it('degradacion elegante: si el cache falla, igual devuelve el dato real', async () => {
    const cache = {
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => {
        throw new Error('redis down');
      },
      del: async () => {},
      counter: async () => undefined,
      incr: async () => undefined,
      ping: async () => false,
    };
    const value = await cached(cache, 'k1', 60, async () => ({ a: 'from-db' }));
    expect(value).toEqual({ a: 'from-db' });
  });
});

describe('cacheKey()', () => {
  it('mismo contenido, distinto orden -> misma clave', () => {
    expect(cacheKey('matches', { seasonId: 1, status: 'FINISHED' })).toBe(
      cacheKey('matches', { status: 'FINISHED', seasonId: 1 }),
    );
  });

  it('ignora valores undefined', () => {
    expect(cacheKey('teams', { q: 'fra', country: undefined })).toBe(cacheKey('teams', { q: 'fra' }));
  });
});

describe('dataset version (invalidacion O(1))', () => {
  it('empieza en 0 y cada bump la incrementa', async () => {
    const cache = fakeCache();
    expect(await datasetVersion(cache)).toBe(0);
    expect(await bumpDatasetVersion(cache)).toBe(1);
    expect(await datasetVersion(cache)).toBe(1);
  });

  it('con Redis caido devuelve undefined en vez de lanzar (el catalogo salta el cache)', async () => {
    const cache = fakeCache({ fail: true });
    await expect(datasetVersion(cache)).resolves.toBeUndefined();
    await expect(bumpDatasetVersion(cache)).resolves.toBeUndefined();
  });
});
