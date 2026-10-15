import type { Queryable } from '../../shared/database/queryable.js';

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
 * Una corrida en RUNNING mas vieja que esto se considera abandonada (el proceso murio a
 * mitad) y se puede reintentar con la misma clave. Una ingesta real tarda segundos.
 */
export const STALE_RUN_SECONDS = 15 * 60;

/**
 * - `started`: esta llamada es duena de la corrida y debe ejecutarla.
 * - `completed`: ya hubo una corrida COMPLETED con esta clave (idempotencia): no hacer nada.
 * - `running`: otra corrida con esta clave esta en curso ahora mismo: no duplicarla.
 */
export type RunClaim = 'started' | 'completed' | 'running';

export async function startRun(
  db: Queryable,
  sourceId: number,
  idempotencyKey: string,
  triggeredBy: string,
): Promise<{ id: string; claim: RunClaim }> {
  // Un solo INSERT ... ON CONFLICT es atomico: si dos requests llegan a la vez con la misma
  // clave, PostgreSQL bloquea la fila y el segundo reevalua el WHERE ya viendo RUNNING, asi
  // que no "gana" (no devuelve fila). Sin carreras, sin locks manuales.
  const res = await db.query<{ id: string }>(
    `INSERT INTO ingestion_runs (source_id, idempotency_key, status, started_at, triggered_by)
     VALUES ($1, $2, 'RUNNING', now(), $3)
     ON CONFLICT (source_id, idempotency_key) DO UPDATE
       SET status = 'RUNNING', started_at = now(), finished_at = NULL,
           records_processed = 0, records_rejected = 0, error_message = NULL,
           triggered_by = EXCLUDED.triggered_by
       WHERE ingestion_runs.status IN ('PENDING', 'FAILED', 'PARTIAL')
          OR (ingestion_runs.status = 'RUNNING'
              AND ingestion_runs.started_at < now() - make_interval(secs => $4))
     RETURNING id`,
    [sourceId, idempotencyKey, triggeredBy, STALE_RUN_SECONDS],
  );
  const inserted = res.rows[0];
  if (inserted) return { id: inserted.id, claim: 'started' };

  const existing = await db.query<{ id: string; status: RunStatus }>(
    'SELECT id, status FROM ingestion_runs WHERE source_id = $1 AND idempotency_key = $2',
    [sourceId, idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('ingestion run vanished');
  return { id: row.id, claim: row.status === 'COMPLETED' ? 'completed' : 'running' };
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

export interface RunView {
  id: string;
  source: string;
  idempotencyKey: string;
  status: RunStatus;
  recordsProcessed: number;
  recordsRejected: number;
  errorMessage: string | null;
  triggeredBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type RunRow = Omit<RunView, 'createdAt' | 'startedAt' | 'finishedAt'> & {
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export async function findRun(db: Queryable, id: string): Promise<RunView | undefined> {
  const res = await db.query<RunRow>(
    `SELECT r.id, s.code AS source, r.idempotency_key AS "idempotencyKey", r.status,
            r.records_processed AS "recordsProcessed", r.records_rejected AS "recordsRejected",
            r.error_message AS "errorMessage", r.triggered_by AS "triggeredBy",
            r.created_at AS "createdAt", r.started_at AS "startedAt", r.finished_at AS "finishedAt"
       FROM ingestion_runs r
       JOIN data_sources s ON s.id = r.source_id
      WHERE r.id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return undefined;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}
