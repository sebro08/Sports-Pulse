import type { QueryResult, QueryResultRow } from 'pg';

/** Lo minimo que necesitamos de Pool y PoolClient. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

export async function ensureSource(db: Queryable, code: string, name: string): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO data_sources (code, name) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [code, name],
  );
  const row = res.rows[0];
  if (!row) throw new Error('could not upsert data source');
  return row.id;
}

/**
 * Inicia (o reanuda) una corrida. Si ya existe una COMPLETED con la misma
 * idempotency key, no la toca y avisa para que se omita el trabajo.
 */
export async function startRun(
  db: Queryable,
  sourceId: number,
  idempotencyKey: string,
): Promise<{ id: string; alreadyCompleted: boolean }> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO ingestion_runs (source_id, idempotency_key, status, started_at)
     VALUES ($1, $2, 'RUNNING', now())
     ON CONFLICT (source_id, idempotency_key) DO UPDATE
       SET status = 'RUNNING', started_at = now(), finished_at = NULL,
           records_processed = 0, records_rejected = 0, error_message = NULL
       WHERE ingestion_runs.status <> 'COMPLETED'
     RETURNING id`,
    [sourceId, idempotencyKey],
  );
  const inserted = res.rows[0];
  if (inserted) return { id: inserted.id, alreadyCompleted: false };

  const existing = await db.query<{ id: string }>(
    'SELECT id FROM ingestion_runs WHERE source_id = $1 AND idempotency_key = $2',
    [sourceId, idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('ingestion run vanished');
  return { id: row.id, alreadyCompleted: true };
}

export async function finishRun(
  db: Queryable,
  runId: string,
  status: RunStatus,
  processed: number,
  rejected: number,
  errorMessage?: string,
): Promise<void> {
  await db.query(
    `UPDATE ingestion_runs
        SET status = $2, records_processed = $3, records_rejected = $4,
            error_message = $5, finished_at = now()
      WHERE id = $1`,
    [runId, status, processed, rejected, errorMessage?.slice(0, 500) ?? null],
  );
}

export async function upsertCompetition(
  db: Queryable,
  sourceId: number,
  externalId: string,
  name: string,
  country: string | null,
): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO competitions (source_id, external_id, name, country)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_id, external_id) DO UPDATE
       SET name = EXCLUDED.name, country = EXCLUDED.country, updated_at = now()
     RETURNING id`,
    [sourceId, externalId, name, country],
  );
  const row = res.rows[0];
  if (!row) throw new Error('could not upsert competition');
  return row.id;
}

export async function upsertSeason(
  db: Queryable,
  competitionId: number,
  externalId: string,
  name: string,
): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO seasons (competition_id, external_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (competition_id, external_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [competitionId, externalId, name],
  );
  const row = res.rows[0];
  if (!row) throw new Error('could not upsert season');
  return row.id;
}

export async function upsertTeam(
  db: Queryable,
  sourceId: number,
  externalId: string,
  name: string,
  country: string | null,
): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO teams (source_id, external_id, name, country)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_id, external_id) DO UPDATE
       SET name = EXCLUDED.name, country = EXCLUDED.country, updated_at = now()
     RETURNING id`,
    [sourceId, externalId, name, country],
  );
  const row = res.rows[0];
  if (!row) throw new Error('could not upsert team');
  return row.id;
}

export interface MatchInput {
  seasonId: number;
  externalId: string;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  status: 'FINISHED' | 'SCHEDULED';
  homeScore: number | null;
  awayScore: number | null;
  runId: string;
}

export async function upsertMatch(db: Queryable, m: MatchInput): Promise<void> {
  await db.query(
    `INSERT INTO matches (season_id, external_id, home_team_id, away_team_id, kickoff_at,
                          status, home_score, away_score, ingestion_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (season_id, external_id) DO UPDATE
       SET home_team_id = EXCLUDED.home_team_id, away_team_id = EXCLUDED.away_team_id,
           kickoff_at = EXCLUDED.kickoff_at, status = EXCLUDED.status,
           home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
           ingestion_run_id = EXCLUDED.ingestion_run_id, updated_at = now()`,
    [
      m.seasonId,
      m.externalId,
      m.homeTeamId,
      m.awayTeamId,
      m.kickoffAt,
      m.status,
      m.homeScore,
      m.awayScore,
      m.runId,
    ],
  );
}
