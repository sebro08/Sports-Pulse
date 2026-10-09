import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { fakeCache, type FakeCache } from '../helpers/fake-cache.js';
import { fakeDb, isCount } from '../helpers/fake-db.js';

const competition = { id: 1, name: 'Test Cup', country: 'Aland', source: 'statsbomb-open-data' };
const team = { id: 7, name: 'Team A', country: 'Aland', source: 'statsbomb-open-data' };
const matchRow = {
  id: 10,
  season_id: 3,
  kickoff_at: new Date('2018-06-14T15:00:00Z'),
  status: 'FINISHED',
  home_score: 5,
  away_score: 0,
  home_team_id: 7,
  home_team_name: 'Team A',
  away_team_id: 8,
  away_team_name: 'Team B',
};
const opts = { logLevel: 'silent', docs: false };

const dataCall = (db: ReturnType<typeof fakeDb>) => db.calls.find((c) => !isCount(c.text))!;

describe('GET /api/v1/competitions', () => {
  it('devuelve datos con paginacion', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 45 }] : [competition]) });
    const res = await buildApp({ db, cache: fakeCache() }, opts).inject({
      method: 'GET',
      url: '/api/v1/competitions?page=2&pageSize=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([competition]);
    expect(body.pagination).toEqual({ page: 2, pageSize: 10, total: 45, totalPages: 5 });
    expect(dataCall(db).values).toEqual([10, 10]);
  });

  it('un intento de inyeccion SQL viaja como parametro, nunca en el SQL', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 0 }] : []) });
    const evil = "' OR 1=1; DROP TABLE teams; --";
    const res = await buildApp({ db, cache: fakeCache() }, opts).inject({
      method: 'GET',
      url: `/api/v1/competitions?q=${encodeURIComponent(evil)}`,
    });
    expect(res.statusCode).toBe(200);
    const call = dataCall(db);
    expect(call.text).not.toContain('DROP TABLE');
    expect(call.text).not.toContain('1=1');
    expect(call.values?.[0]).toBe(`%${evil}%`);
  });

  it('escapa comodines LIKE en la busqueda', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 0 }] : []) });
    await buildApp({ db, cache: fakeCache() }, opts).inject({ method: 'GET', url: '/api/v1/teams?q=50%25_' });
    expect(dataCall(db).values?.[0]).toBe('%50\\%\\_%');
  });

  it('rechaza pageSize excesivo con VALIDATION_ERROR', async () => {
    const res = await buildApp({ db: fakeDb(), cache: fakeCache() }, opts).inject({
      method: 'GET',
      url: '/api/v1/competitions?pageSize=1000',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details.length).toBeGreaterThan(0);
  });

  it('rechaza campos de orden fuera de la lista blanca', async () => {
    const res = await buildApp({ db: fakeDb(), cache: fakeCache() }, opts).inject({
      method: 'GET',
      url: '/api/v1/competitions?sort=password',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/teams/:id', () => {
  it('devuelve el detalle con matchCount', async () => {
    const db = fakeDb({ rows: () => [{ ...team, match_count: '7' }] });
    const res = await buildApp({ db, cache: fakeCache() }, opts).inject({ method: 'GET', url: '/api/v1/teams/7' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...team, matchCount: 7 });
  });

  it('404 con formato consistente si no existe', async () => {
    const res = await buildApp({ db: fakeDb(), cache: fakeCache() }, opts).inject({
      method: 'GET',
      url: '/api/v1/teams/999',
      headers: { 'x-request-id': 'req-1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'NOT_FOUND', requestId: 'req-1' });
  });

  it('400 si el id no es un entero positivo', async () => {
    const res = await buildApp({ db: fakeDb(), cache: fakeCache() }, opts).inject({ method: 'GET', url: '/api/v1/teams/abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/matches', () => {
  it('mapea filas a camelCase con fecha ISO', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 1 }] : [matchRow]) });
    const res = await buildApp({ db, cache: fakeCache() }, opts).inject({ method: 'GET', url: '/api/v1/matches' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toEqual({
      id: 10,
      seasonId: 3,
      kickoffAt: '2018-06-14T15:00:00.000Z',
      status: 'FINISHED',
      homeScore: 5,
      awayScore: 0,
      homeTeam: { id: 7, name: 'Team A' },
      awayTeam: { id: 8, name: 'Team B' },
    });
  });

  it('combina filtros como parametros y hace "to" inclusivo', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 0 }] : []) });
    const res = await buildApp({ db, cache: fakeCache() }, opts).inject({
      method: 'GET',
      url: '/api/v1/matches?teamId=5&status=FINISHED&from=2018-06-01&to=2018-06-30',
    });
    expect(res.statusCode).toBe(200);
    const call = dataCall(db);
    expect(call.text).toContain('m.home_team_id = $1 OR m.away_team_id = $1');
    expect(call.values).toEqual([
      5,
      'FINISHED',
      '2018-06-01T00:00:00.000Z',
      '2018-07-01T00:00:00.000Z',
      20,
      0,
    ]);
  });

  it('rechaza fechas imposibles y rangos invertidos', async () => {
    const app = buildApp({ db: fakeDb(), cache: fakeCache() }, opts);
    const bad = await app.inject({ method: 'GET', url: '/api/v1/matches?from=2018-02-30' });
    expect(bad.statusCode).toBe(400);
    const inverted = await app.inject({
      method: 'GET',
      url: '/api/v1/matches?from=2018-07-01&to=2018-06-01',
    });
    expect(inverted.statusCode).toBe(400);
  });
});

describe('cache-aside integrado en la API', () => {
  it('una segunda peticion identica NO vuelve a consultar la base de datos', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 1 }] : [competition]) });
    const cache: FakeCache = fakeCache();
    const app = buildApp({ db, cache }, opts);

    const first = await app.inject({ method: 'GET', url: '/api/v1/competitions?q=test' });
    expect(first.statusCode).toBe(200);
    const callsAfterFirst = db.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await app.inject({ method: 'GET', url: '/api/v1/competitions?q=test' });
    expect(second.statusCode).toBe(200);
    expect(db.calls.length).toBe(callsAfterFirst); // nada nuevo: vino de cache
    expect(second.json()).toEqual(first.json());
  });

  it('parametros distintos no comparten cache (sin colisiones)', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 1 }] : [competition]) });
    const cache: FakeCache = fakeCache();
    const app = buildApp({ db, cache }, opts);

    await app.inject({ method: 'GET', url: '/api/v1/competitions?q=aaa' });
    const callsAfterFirst = db.calls.length;
    await app.inject({ method: 'GET', url: '/api/v1/competitions?q=bbb' });
    expect(db.calls.length).toBeGreaterThan(callsAfterFirst); // distinto query -> nueva consulta real
  });

  it('si Redis esta caido, la API sigue respondiendo 200 consultando PostgreSQL', async () => {
    const db = fakeDb({ rows: (t) => (isCount(t) ? [{ total: 1 }] : [competition]) });
    const cache = fakeCache({ fail: true });
    const res = await buildApp({ db, cache }, opts).inject({ method: 'GET', url: '/api/v1/competitions' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([competition]);
  });
});

describe('OpenAPI', () => {
  it('publica la especificacion generada desde los esquemas Zod', async () => {
    const app = buildApp({ db: fakeDb(), cache: fakeCache() }, { logLevel: 'silent', docs: true });
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.paths['/api/v1/competitions']).toBeDefined();
    expect(spec.paths['/api/v1/matches/{id}']).toBeDefined();
  });
});
