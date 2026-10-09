import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { fakeCache } from '../helpers/fake-cache.js';
import { fakeDb } from '../helpers/fake-db.js';

const opts = { logLevel: 'silent', docs: false };

describe('health endpoints', () => {
  it('liveness responde 200 sin tocar la base de datos', async () => {
    const app = buildApp({ db: fakeDb({ pingFails: true }), cache: fakeCache() }, opts);
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });

  it('readiness responde 200 cuando la base de datos esta disponible', async () => {
    const app = buildApp({ db: fakeDb(), cache: fakeCache() }, opts);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks).toEqual({ postgres: 'up', redis: 'up' });
  });

  it('readiness responde 503 cuando la base de datos falla', async () => {
    const app = buildApp({ db: fakeDb({ pingFails: true }), cache: fakeCache() }, opts);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });

  it('readiness sigue en 200 si SOLO Redis esta caido (degradacion elegante)', async () => {
    const app = buildApp({ db: fakeDb(), cache: fakeCache({ fail: true }) }, opts);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks).toEqual({ postgres: 'up', redis: 'down' });
  });

  it('devuelve error consistente con requestId en rutas inexistentes', async () => {
    const app = buildApp({ db: fakeDb(), cache: fakeCache() }, opts);
    const res = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.requestId).toBe('abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
