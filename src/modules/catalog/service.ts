import { cached, cacheKey } from '../../shared/cache/cache-aside.js';
import type { Cache } from '../../shared/cache/types.js';
import type { Queryable } from '../../shared/database/queryable.js';
import { NotFoundError } from '../../shared/http/errors.js';
import { toPage, type Page } from '../../shared/http/pagination.js';
import * as repo from './repository.js';
import type {
  Competition,
  CompetitionsQuery,
  MatchDetail,
  MatchesQuery,
  MatchSummary,
  Season,
  SeasonsQuery,
  Team,
  TeamDetail,
  TeamsQuery,
} from './schemas.js';

export interface CacheTtl {
  list: number;
  detail: number;
}

export interface Deps {
  db: Queryable;
  cache: Cache;
  ttl: CacheTtl;
}

export async function listCompetitions(
  { db, cache, ttl }: Deps,
  q: CompetitionsQuery,
): Promise<Page<Competition>> {
  return cached(cache, cacheKey('competitions', q), ttl.list, async () => {
    const { rows, total } = await repo.listCompetitions(db, q);
    return toPage(rows, total, q.page, q.pageSize);
  });
}

export async function listSeasons({ db, cache, ttl }: Deps, q: SeasonsQuery): Promise<Page<Season>> {
  return cached(cache, cacheKey('seasons', q), ttl.list, async () => {
    const { rows, total } = await repo.listSeasons(db, q);
    return toPage(rows, total, q.page, q.pageSize);
  });
}

export async function listTeams({ db, cache, ttl }: Deps, q: TeamsQuery): Promise<Page<Team>> {
  return cached(cache, cacheKey('teams', q), ttl.list, async () => {
    const { rows, total } = await repo.listTeams(db, q);
    return toPage(rows, total, q.page, q.pageSize);
  });
}

export async function getTeam({ db, cache, ttl }: Deps, id: number): Promise<TeamDetail> {
  return cached(cache, cacheKey('team', { id }), ttl.detail, async () => {
    const team = await repo.findTeam(db, id);
    if (!team) throw new NotFoundError('Team');
    return team;
  });
}

export async function listMatches({ db, cache, ttl }: Deps, q: MatchesQuery): Promise<Page<MatchSummary>> {
  return cached(cache, cacheKey('matches', q), ttl.list, async () => {
    const { rows, total } = await repo.listMatches(db, q);
    return toPage(rows, total, q.page, q.pageSize);
  });
}

export async function getMatch({ db, cache, ttl }: Deps, id: number): Promise<MatchDetail> {
  return cached(cache, cacheKey('match', { id }), ttl.detail, async () => {
    const match = await repo.findMatch(db, id);
    if (!match) throw new NotFoundError('Match');
    return match;
  });
}
