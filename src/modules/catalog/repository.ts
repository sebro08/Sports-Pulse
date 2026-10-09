import { escapeLike, orderBy, selectPage, where } from '../../shared/database/query.js';
import type { Queryable } from '../../shared/database/queryable.js';
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

const COMPETITION_SORT = { id: 'c.id', name: 'c.name', country: 'c.country' };
const SEASON_SORT = { id: 's.id', name: 's.name' };
const TEAM_SORT = { id: 't.id', name: 't.name', country: 't.country' };
const MATCH_SORT = { id: 'm.id', kickoff: 'm.kickoff_at' };

const iso = (value: Date | string): string => new Date(value).toISOString();

export async function listCompetitions(
  db: Queryable,
  q: CompetitionsQuery,
): Promise<{ rows: Competition[]; total: number }> {
  return selectPage<Competition>(db, {
    select: 'c.id, c.name, c.country, ds.code AS source',
    from: 'competitions c JOIN data_sources ds ON ds.id = c.source_id',
    countFrom: 'competitions c',
    where: where([
      q.country ? { sql: 'c.country ILIKE ?', value: escapeLike(q.country) } : undefined,
      q.q ? { sql: 'c.name ILIKE ?', value: `%${escapeLike(q.q)}%` } : undefined,
    ]),
    order: orderBy(q.sort, COMPETITION_SORT, 'c.id'),
    page: q.page,
    pageSize: q.pageSize,
  });
}

interface SeasonRow {
  id: number;
  competition_id: number;
  competition_name: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

export async function listSeasons(
  db: Queryable,
  q: SeasonsQuery,
): Promise<{ rows: Season[]; total: number }> {
  const { rows, total } = await selectPage<SeasonRow>(db, {
    select:
      's.id, s.competition_id, c.name AS competition_name, s.name, ' +
      's.start_date::text AS start_date, s.end_date::text AS end_date',
    from: 'seasons s JOIN competitions c ON c.id = s.competition_id',
    countFrom: 'seasons s',
    where: where([
      q.competitionId ? { sql: 's.competition_id = ?', value: q.competitionId } : undefined,
    ]),
    order: orderBy(q.sort, SEASON_SORT, 's.id'),
    page: q.page,
    pageSize: q.pageSize,
  });
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      competitionId: r.competition_id,
      competitionName: r.competition_name,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
    })),
  };
}

export async function listTeams(
  db: Queryable,
  q: TeamsQuery,
): Promise<{ rows: Team[]; total: number }> {
  return selectPage<Team>(db, {
    select: 't.id, t.name, t.country, ds.code AS source',
    from: 'teams t JOIN data_sources ds ON ds.id = t.source_id',
    countFrom: 'teams t',
    where: where([
      q.country ? { sql: 't.country ILIKE ?', value: escapeLike(q.country) } : undefined,
      q.q ? { sql: 't.name ILIKE ?', value: `%${escapeLike(q.q)}%` } : undefined,
    ]),
    order: orderBy(q.sort, TEAM_SORT, 't.id'),
    page: q.page,
    pageSize: q.pageSize,
  });
}

interface TeamDetailRow extends Team {
  match_count: number | string;
}

export async function findTeam(db: Queryable, id: number): Promise<TeamDetail | undefined> {
  const res = await db.query<TeamDetailRow>(
    `SELECT t.id, t.name, t.country, ds.code AS source,
            (SELECT count(*) FROM matches m
              WHERE m.home_team_id = t.id OR m.away_team_id = t.id) AS match_count
       FROM teams t JOIN data_sources ds ON ds.id = t.source_id
      WHERE t.id = $1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return undefined;
  return { id: r.id, name: r.name, country: r.country, source: r.source, matchCount: Number(r.match_count) };
}

interface MatchRow {
  id: number;
  season_id: number;
  kickoff_at: Date | string;
  status: MatchSummary['status'];
  home_score: number | null;
  away_score: number | null;
  home_team_id: number;
  home_team_name: string;
  away_team_id: number;
  away_team_name: string;
}

interface MatchDetailRow extends MatchRow {
  season_name: string;
  competition_id: number;
  competition_name: string;
  source: string;
  updated_at: Date | string;
}

const MATCH_COLUMNS =
  'm.id, m.season_id, m.kickoff_at, m.status, m.home_score, m.away_score, ' +
  'm.home_team_id, ht.name AS home_team_name, m.away_team_id, awt.name AS away_team_name';
const MATCH_JOINS =
  'JOIN teams ht ON ht.id = m.home_team_id JOIN teams awt ON awt.id = m.away_team_id';

const toMatchSummary = (r: MatchRow): MatchSummary => ({
  id: r.id,
  seasonId: r.season_id,
  kickoffAt: iso(r.kickoff_at),
  status: r.status,
  homeScore: r.home_score,
  awayScore: r.away_score,
  homeTeam: { id: r.home_team_id, name: r.home_team_name },
  awayTeam: { id: r.away_team_id, name: r.away_team_name },
});

export async function listMatches(
  db: Queryable,
  q: MatchesQuery,
): Promise<{ rows: MatchSummary[]; total: number }> {
  const toExclusive = q.to
    ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000).toISOString()
    : undefined;
  const { rows, total } = await selectPage<MatchRow>(db, {
    select: MATCH_COLUMNS,
    from: `matches m ${MATCH_JOINS}`,
    countFrom: 'matches m',
    where: where([
      q.seasonId ? { sql: 'm.season_id = ?', value: q.seasonId } : undefined,
      q.teamId
        ? { sql: '(m.home_team_id = ? OR m.away_team_id = ?)', value: q.teamId }
        : undefined,
      q.status ? { sql: 'm.status = ?', value: q.status } : undefined,
      q.from
        ? { sql: 'm.kickoff_at >= ?', value: new Date(`${q.from}T00:00:00Z`).toISOString() }
        : undefined,
      toExclusive ? { sql: 'm.kickoff_at < ?', value: toExclusive } : undefined,
    ]),
    order: orderBy(q.sort, MATCH_SORT, 'm.id'),
    page: q.page,
    pageSize: q.pageSize,
  });
  return { rows: rows.map(toMatchSummary), total };
}

export async function findMatch(db: Queryable, id: number): Promise<MatchDetail | undefined> {
  const res = await db.query<MatchDetailRow>(
    `SELECT ${MATCH_COLUMNS},
            s.name AS season_name, c.id AS competition_id, c.name AS competition_name,
            ds.code AS source, m.updated_at
       FROM matches m ${MATCH_JOINS}
       JOIN seasons s ON s.id = m.season_id
       JOIN competitions c ON c.id = s.competition_id
       JOIN data_sources ds ON ds.id = c.source_id
      WHERE m.id = $1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return undefined;
  return {
    ...toMatchSummary(r),
    season: { id: r.season_id, name: r.season_name },
    competition: { id: r.competition_id, name: r.competition_name },
    source: r.source,
    updatedAt: iso(r.updated_at),
  };
}
