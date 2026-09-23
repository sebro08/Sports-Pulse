import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

const up = { ping: async () => {} };
const down = {
  ping: async () => {
    throw new Error('db down');
  },
};

describe('health endpoints', () => {
  it('liveness responde 200 sin tocar la base de datos', async () => {
    const app = buildApp({ db: down }, { logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });

  it('readiness responde 200 cuando la base de datos esta disponible', async () => {
    const app = buildApp({ db: up }, { logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('readiness responde 503 cuando la base de datos falla', async () => {
    const app = buildApp({ db: down }, { logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });

  it('devuelve error consistente con requestId en rutas inexistentes', async () => {
    const app = buildApp({ db: up }, { logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/nope', headers: { 'x-request-id': 'abc-123' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.requestId).toBe('abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
