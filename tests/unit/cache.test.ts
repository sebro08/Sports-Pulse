import { describe, expect, it } from 'vitest';
import { cached, cacheKey } from '../../src/shared/cache/cache-aside.js';
import { nullCache, wrapRedis, type RedisLike } from '../../src/shared/cache/redis-cache.js';

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
    const healthy: RedisLike = { get: async () => null, set: async () => 'OK', del: async () => 1, ping: async () => 'PONG' };
    expect(await wrapRedis(healthy).ping()).toBe(true);
  });

  it('traduce null (miss real de Redis) a undefined', async () => {
    const client: RedisLike = { get: async () => null, set: async () => 'OK', del: async () => 1, ping: async () => 'PONG' };
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
