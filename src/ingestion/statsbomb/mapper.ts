import type { StatsBombMatch } from './schemas.js';

/**
 * StatsBomb entrega fecha y hora local del estadio SIN zona horaria.
 * Se guardan como UTC (aproximacion documentada en docs/data-management.md).
 */
export function toKickoff(matchDate: string, kickOff?: string | null): Date {
  const time = (kickOff ?? '00:00:00').slice(0, 8);
  return new Date(`${matchDate}T${time}Z`);
}

export function toMatchStatus(m: StatsBombMatch): 'FINISHED' | 'SCHEDULED' {
  return m.home_score != null && m.away_score != null ? 'FINISHED' : 'SCHEDULED';
}
