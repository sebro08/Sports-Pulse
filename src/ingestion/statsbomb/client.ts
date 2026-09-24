/**
 * Endpoints autorizados de StatsBomb Open Data.
 * Anti-SSRF: la base es una constante y solo se interpolan enteros validados;
 * nunca se acepta una URL proporcionada por el usuario.
 */
const BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';

function assertId(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function competitionsUrl(): string {
  return `${BASE}/competitions.json`;
}

export function matchesUrl(competitionId: number, seasonId: number): string {
  assertId(competitionId, 'competitionId');
  assertId(seasonId, 'seasonId');
  return `${BASE}/matches/${competitionId}/${seasonId}.json`;
}
