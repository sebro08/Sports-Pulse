import type { StatsBombMatch } from './schemas.js';

export function toKickoff(matchDate: string, kickOff?: string | null): Date {
  const time = (kickOff ?? '00:00:00').slice(0, 8);
  return new Date(`${matchDate}T${time}Z`);
}

export function toMatchStatus(m: StatsBombMatch): 'FINISHED' | 'SCHEDULED' {
  return m.home_score != null && m.away_score != null ? 'FINISHED' : 'SCHEDULED';
}
