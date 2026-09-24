import { describe, expect, it } from 'vitest';
import { toKickoff, toMatchStatus } from '../../src/ingestion/statsbomb/mapper.js';
import { matchSchema } from '../../src/ingestion/statsbomb/schemas.js';
import { matchesUrl } from '../../src/ingestion/statsbomb/client.js';
import { parseRecords } from '../../src/ingestion/validation.js';

// Datos de ejemplo inventados (no son partidos reales).
const sample = {
  match_id: 1001,
  match_date: '2018-07-15',
  kick_off: '17:00:00.000',
  home_score: 2,
  away_score: 1,
  home_team: { home_team_id: 10, home_team_name: 'Team A', country: { name: 'Aland' } },
  away_team: { away_team_id: 20, away_team_name: 'Team B' },
};

describe('matchSchema', () => {
  it('acepta un partido valido', () => {
    expect(matchSchema.safeParse(sample).success).toBe(true);
  });

  it('rechaza marcador negativo', () => {
    expect(matchSchema.safeParse({ ...sample, home_score: -1 }).success).toBe(false);
  });

  it('rechaza mismo equipo como local y visitante', () => {
    const bad = { ...sample, away_team: { away_team_id: 10, away_team_name: 'Team A' } };
    expect(matchSchema.safeParse(bad).success).toBe(false);
  });

  it('rechaza fechas que no existen', () => {
    expect(matchSchema.safeParse({ ...sample, match_date: '2018-02-30' }).success).toBe(false);
  });
});

describe('mapper', () => {
  it('combina fecha y hora en UTC', () => {
    expect(toKickoff('2018-07-15', '17:00:00.000').toISOString()).toBe('2018-07-15T17:00:00.000Z');
  });

  it('usa medianoche si no hay hora', () => {
    expect(toKickoff('2018-07-15', null).toISOString()).toBe('2018-07-15T00:00:00.000Z');
  });

  it('marca FINISHED solo si hay marcador completo', () => {
    const parsed = matchSchema.parse(sample);
    expect(toMatchStatus(parsed)).toBe('FINISHED');
    expect(toMatchStatus({ ...parsed, away_score: null })).toBe('SCHEDULED');
  });
});

describe('parseRecords', () => {
  it('separa validos y rechazados con el indice', () => {
    const { valid, rejected } = parseRecords(matchSchema, [sample, { ...sample, home_score: -5 }]);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.index).toBe(1);
  });
});

describe('matchesUrl (anti-SSRF)', () => {
  it('solo acepta enteros positivos', () => {
    expect(matchesUrl(43, 3)).toContain('/matches/43/3.json');
    expect(() => matchesUrl(1.5, 3)).toThrow();
    expect(() => matchesUrl(-1, 3)).toThrow();
  });
});
