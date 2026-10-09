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

export async function listCompetitions(db: Queryable, q: CompetitionsQuery): Promise<Page<Competition>> {
  const { rows, total } = await repo.listCompetitions(db, q);
  return toPage(rows, total, q.page, q.pageSize);
}

export async function listSeasons(db: Queryable, q: SeasonsQuery): Promise<Page<Season>> {
  const { rows, total } = await repo.listSeasons(db, q);
  return toPage(rows, total, q.page, q.pageSize);
}

export async function listTeams(db: Queryable, q: TeamsQuery): Promise<Page<Team>> {
  const { rows, total } = await repo.listTeams(db, q);
  return toPage(rows, total, q.page, q.pageSize);
}

export async function getTeam(db: Queryable, id: number): Promise<TeamDetail> {
  const team = await repo.findTeam(db, id);
  if (!team) throw new NotFoundError('Team');
  return team;
}

export async function listMatches(db: Queryable, q: MatchesQuery): Promise<Page<MatchSummary>> {
  const { rows, total } = await repo.listMatches(db, q);
  return toPage(rows, total, q.page, q.pageSize);
}

export async function getMatch(db: Queryable, id: number): Promise<MatchDetail> {
  const match = await repo.findMatch(db, id);
  if (!match) throw new NotFoundError('Match');
  return match;
}
