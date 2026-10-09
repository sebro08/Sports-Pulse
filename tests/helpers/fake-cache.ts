import type { Cache } from '../../src/shared/cache/types.js';

export interface FakeCacheOptions {
  /** Simula una caida total de Redis: get/set/del lanzan, ping devuelve false. */
  fail?: boolean;
}

export interface FakeCache extends Cache {
  store: Map<string, string>;
  getCalls: string[];
  setCalls: Array<{ key: string; value: string; ttlSeconds: number }>;
}

export function fakeCache(opts: FakeCacheOptions = {}): FakeCache {
  const store = new Map<string, string>();
  const getCalls: string[] = [];
  const setCalls: FakeCache['setCalls'] = [];
  return {
    store,
    getCalls,
    setCalls,
    async get(key) {
      getCalls.push(key);
      if (opts.fail) throw new Error('redis down');
      return store.get(key);
    },
    async set(key, value, ttlSeconds) {
      setCalls.push({ key, value, ttlSeconds });
      if (opts.fail) throw new Error('redis down');
      store.set(key, value);
    },
    async del(key) {
      if (opts.fail) throw new Error('redis down');
      store.delete(key);
    },
    async ping() {
      return !opts.fail;
    },
  };
}
