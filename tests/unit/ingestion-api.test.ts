import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  ClaimedRun,
  IngestionRunner,
  IngestParams,
  IngestResult,
} from '../../src/modules/ingestion/service.js';
import type { RunClaim } from '../../src/modules/ingestion/repository.js';
import { datasetVersion } from '../../src/shared/cache/dataset-version.js';
import { bearer, tokenFor, verifyToken } from '../helpers/auth.js';
import { fakeCache } from '../helpers/fake-cache.js';
import { fakeDb, isCount } from '../helpers/fake-db.js';

const RUN_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const opts = { logLevel: 'silent', docs: false, rateLimit: false as const };
const body = { competitionId: 43, seasonId: 3 };

/** Runner falso: registra las llamadas y devuelve lo que el test configure. */
function fakeRunner(claim: RunClaim = 'started', status: IngestResult['status'] = 'COMPLETED') {
  const claims: IngestParams[] = [];
  const executions: ClaimedRun[] = [];
  const runner: IngestionRunner = {
    async claim(params) {
      claims.push(params);
      return { runId: RUN_ID, claim, sourceId: 1 };
    },
    async execute(run) {
      executions.push(run);
      return { runId: run.runId, status, processed: 64, rejected: 0, skipped: false };
    },
  };
  return { runner, claims, executions };
}

function setup(runner: IngestionRunner, db = fakeDb(), { withRateLimit = false } = {}) {
  const cache = fakeCache();
  const app = buildApp(
    { db, cache, verifyToken, ingestion: runner },
    // Sin `rateLimit` en las opciones, buildApp usa el limite global por defecto.
    withRateLimit ? { logLevel: 'silent', docs: false } : opts,
  );
  return { app, cache };
}

const post = async (app: ReturnType<typeof buildApp>, roles?: string[], payload: object = body) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/ingestion',
    payload,
    headers: roles ? bearer(await tokenFor(roles, 'seb')) : {},
  });

describe('POST /api/v1/ingestion: autorizacion', () => {
  it('sin token -> 401 y NO se toca la base de datos', async () => {
    const { runner, claims } = fakeRunner();
    const res = await post(setup(runner).app);
    expect(res.statusCode).toBe(401);
    expect(claims).toHaveLength(0);
  });

  it('rol USER -> 403 (autenticado pero sin permiso)', async () => {
    const { runner, claims } = fakeRunner();
    const res = await post(setup(runner).app, ['USER']);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(claims).toHaveLength(0);
  });

  it('rol SYSTEM (identidad de maquina) puede lanzar ingestas', async () => {
    const { runner } = fakeRunner();
    const res = await post(setup(runner).app, ['SYSTEM']);
    expect(res.statusCode).toBe(202);
  });
});

describe('POST /api/v1/ingestion: comportamiento', () => {
  it('ADMIN -> 202 Accepted con runId, Location y quien la lanzo', async () => {
    const { runner, claims } = fakeRunner();
    const { app } = setup(runner);
    const res = await post(app, ['ADMIN']);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      runId: RUN_ID,
      status: 'RUNNING',
      statusUrl: `/api/v1/ingestion/${RUN_ID}`,
    });
    expect(res.headers.location).toBe(`/api/v1/ingestion/${RUN_ID}`);
    expect(claims[0]).toMatchObject({ competitionId: 43, seasonId: 3, triggeredBy: 'seb' });
  });

  it('al terminar con datos nuevos, invalida el cache del catalogo (sube la version)', async () => {
    const { runner, executions } = fakeRunner('started', 'COMPLETED');
    const { app, cache } = setup(runner);
    await post(app, ['ADMIN']);
    await app.close(); // onClose espera a que la corrida en segundo plano termine
    expect(executions).toHaveLength(1);
    expect(await datasetVersion(cache)).toBe(1);
  });

  it('una corrida FAILED no invalida el cache (hubo ROLLBACK, nada cambio)', async () => {
    const { runner } = fakeRunner('started', 'FAILED');
    const { app, cache } = setup(runner);
    await post(app, ['ADMIN']);
    await app.close();
    expect(await datasetVersion(cache)).toBe(0);
  });

  it('idempotencia: clave ya COMPLETED -> 200 sin volver a ejecutar', async () => {
    const { runner, executions } = fakeRunner('completed');
    const { app } = setup(runner);
    const res = await post(app, ['ADMIN'], { ...body, idempotencyKey: 'wc-2018' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('COMPLETED');
    expect(executions).toHaveLength(0);
  });

  it('misma clave ya en curso -> 202 con el MISMO runId, sin duplicar la ejecucion', async () => {
    const { runner, executions } = fakeRunner('running');
    const { app } = setup(runner);
    const res = await post(app, ['ADMIN']);
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().runId).toBe(RUN_ID);
    expect(executions).toHaveLength(0);
  });

  it('valida el body: ids no numericos, campos extra y claves con caracteres raros -> 400', async () => {
    const { runner, claims } = fakeRunner();
    const { app } = setup(runner);
    for (const payload of [
      { competitionId: 'abc', seasonId: 3 },
      { ...body, url: 'http://169.254.169.254/' }, // campo extra: rechazado (.strict())
      { ...body, idempotencyKey: 'a b; DROP TABLE' },
    ]) {
      const res = await post(app, ['ADMIN'], payload);
      expect(res.statusCode).toBe(400);
    }
    expect(claims).toHaveLength(0);
  });

  it('rate limit propio: la 6a llamada en un minuto -> 429 con Retry-After', async () => {
    const { runner } = fakeRunner('completed');
    const { app } = setup(runner, fakeDb(), { withRateLimit: true });
    const token = await tokenFor(['ADMIN']);
    const call = () =>
      app.inject({ method: 'POST', url: '/api/v1/ingestion', payload: body, headers: bearer(token) });
    for (let i = 0; i < 5; i++) expect((await call()).statusCode).toBe(200);
    const res = await call();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/v1/ingestion/:id', () => {
  const row = {
    id: RUN_ID,
    source: 'statsbomb-open-data',
    idempotencyKey: 'wc-2018',
    status: 'COMPLETED',
    recordsProcessed: 64,
    recordsRejected: 0,
    errorMessage: null,
    triggeredBy: 'seb',
    createdAt: new Date('2026-10-15T10:00:00Z'),
    startedAt: new Date('2026-10-15T10:00:00Z'),
    finishedAt: new Date('2026-10-15T10:00:03Z'),
  };

  it('ADMIN ve el estado de la corrida, incluido quien la lanzo', async () => {
    const db = fakeDb({ rows: (t) => (t.includes('ingestion_runs') ? [row] : []) });
    const { app } = setup(fakeRunner().runner, db);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ingestion/${RUN_ID}`,
      headers: bearer(await tokenFor(['ADMIN'])),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'COMPLETED',
      triggeredBy: 'seb',
      finishedAt: '2026-10-15T10:00:03.000Z',
    });
    expect(db.calls[0]?.values).toEqual([RUN_ID]);
  });

  it('id que no es UUID -> 400; corrida inexistente -> 404; anonimo -> 401', async () => {
    const { app } = setup(fakeRunner().runner);
    const headers = bearer(await tokenFor(['ADMIN']));
    const bad = await app.inject({ method: 'GET', url: '/api/v1/ingestion/1 OR 1=1', headers });
    const missing = await app.inject({ method: 'GET', url: `/api/v1/ingestion/${RUN_ID}`, headers });
    const anon = await app.inject({ method: 'GET', url: `/api/v1/ingestion/${RUN_ID}` });
    expect(bad.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(anon.statusCode).toBe(401);
  });
});

describe('rate limit global', () => {
  it('limita por IP, responde con el formato de error uniforme y no limita los probes', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 0 }] : []) });
    const app = buildApp(
      { db, cache: fakeCache() },
      { logLevel: 'silent', docs: false, rateLimit: { max: 2, windowSeconds: 60 } },
    );
    const get = (url: string) => app.inject({ method: 'GET', url });
    expect((await get('/api/v1/teams')).statusCode).toBe(200);
    expect((await get('/api/v1/teams')).statusCode).toBe(200);
    const limited = await get('/api/v1/teams');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.json().error.requestId).toBeDefined();
    for (let i = 0; i < 5; i++) expect((await get('/health/live')).statusCode).toBe(200);
  });
});

describe('invalidacion del cache del catalogo', () => {
  it('tras subir la version del dataset, la siguiente lectura va a PostgreSQL', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 0 }] : []) });
    const { runner } = fakeRunner('started', 'COMPLETED');
    const { app, cache } = setup(runner, db);
    const read = () => app.inject({ method: 'GET', url: '/api/v1/teams' });

    await read(); // miss -> BD
    await read(); // hit -> sin BD
    const before = db.calls.length;
    expect(before).toBe(2); // listado + count, solo la primera vez

    await post(app, ['ADMIN']);
    await vi.waitFor(async () => expect(await datasetVersion(cache)).toBe(1)); // corrida en 2o plano
    await read();
    expect(db.calls.length).toBe(before + 2); // miss: la clave vieja ya no se usa
  });
});
