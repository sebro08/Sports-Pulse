import type { Pool } from 'pg';
import { fetchJson } from './http.js';
import {
  ensureSource,
  finishRun,
  startRun,
  upsertCompetition,
  upsertMatch,
  upsertSeason,
  upsertTeam,
  type RunStatus,
} from './repository.js';
import { competitionsUrl, matchesUrl } from './statsbomb/client.js';
import { toKickoff, toMatchStatus } from './statsbomb/mapper.js';
import { competitionEntrySchema, matchSchema, type StatsBombMatch } from './statsbomb/schemas.js';
import { parseRecords } from './validation.js';

export const STATSBOMB_SOURCE = { code: 'statsbomb-open-data', name: 'StatsBomb Open Data' };

export interface IngestParams {
  competitionId: number;
  seasonId: number;
  /** Por defecto: una corrida por competicion/temporada/dia. */
  idempotencyKey?: string;
}

export interface IngestDeps {
  fetchJson?: typeof fetchJson;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface IngestResult {
  runId: string;
  status: RunStatus;
  processed: number;
  rejected: number;
  skipped: boolean;
  error?: string;
}

export async function ingestStatsBomb(
  pool: Pool,
  params: IngestParams,
  deps: IngestDeps = {},
): Promise<IngestResult> {
  const get = deps.fetchJson ?? fetchJson;
  const log = deps.log ?? (() => {});
  const { competitionId, seasonId } = params;

  const sourceId = await ensureSource(pool, STATSBOMB_SOURCE.code, STATSBOMB_SOURCE.name);
  const key =
    params.idempotencyKey ??
    `statsbomb:c${competitionId}:s${seasonId}:${new Date().toISOString().slice(0, 10)}`;

  const run = await startRun(pool, sourceId, key);
  if (run.alreadyCompleted) {
    log('run already completed for this idempotency key, skipping', { runId: run.id, key });
    return { runId: run.id, status: 'COMPLETED', processed: 0, rejected: 0, skipped: true };
  }
  log('run started', { runId: run.id, key });

  try {
    // 1. Catalogo: confirmar que la competicion/temporada existe en la fuente.
    const catalog = await get(competitionsUrl());
    if (!Array.isArray(catalog)) throw new Error('competitions.json is not an array');
    const { valid: entries } = parseRecords(competitionEntrySchema, catalog);
    const entry = entries.find(
      (e) => e.competition_id === competitionId && e.season_id === seasonId,
    );
    if (!entry) {
      throw new Error(`competition ${competitionId} / season ${seasonId} not found in catalog`);
    }

    // 2. Partidos: validar registro a registro.
    const raw = await get(matchesUrl(competitionId, seasonId));
    if (!Array.isArray(raw)) throw new Error('matches file is not an array');
    const { valid, rejected } = parseRecords(matchSchema, raw);
    for (const r of rejected) log('record rejected', { index: r.index, issues: r.issues });

    if (valid.length === 0 && rejected.length > 0) {
      throw new Error(`all ${rejected.length} match records were rejected`);
    }

    // 3. Persistir en una sola transaccion (todo o nada).
    await persist(pool, sourceId, run.id, entry, valid);

    const status: RunStatus = rejected.length > 0 ? 'PARTIAL' : 'COMPLETED';
    await finishRun(pool, run.id, status, valid.length, rejected.length);
    log('run finished', { runId: run.id, status, processed: valid.length, rejected: rejected.length });
    return {
      runId: run.id,
      status,
      processed: valid.length,
      rejected: rejected.length,
      skipped: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(pool, run.id, 'FAILED', 0, 0, message);
    log('run failed', { runId: run.id, error: message });
    return {
      runId: run.id,
      status: 'FAILED',
      processed: 0,
      rejected: 0,
      skipped: false,
      error: message,
    };
  }
}

async function persist(
  pool: Pool,
  sourceId: number,
  runId: string,
  entry: { competition_id: number; season_id: number; competition_name: string; season_name: string; country_name?: string | null | undefined },
  matches: StatsBombMatch[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const competitionDbId = await upsertCompetition(
      client,
      sourceId,
      String(entry.competition_id),
      entry.competition_name,
      entry.country_name ?? null,
    );
    const seasonDbId = await upsertSeason(
      client,
      competitionDbId,
      String(entry.season_id),
      entry.season_name,
    );

    const teamIds = new Map<number, number>();
    const teamId = async (externalId: number, name: string, country: string | null) => {
      const cached = teamIds.get(externalId);
      if (cached !== undefined) return cached;
      const id = await upsertTeam(client, sourceId, String(externalId), name, country);
      teamIds.set(externalId, id);
      return id;
    };

    for (const m of matches) {
      const homeTeamId = await teamId(
        m.home_team.home_team_id,
        m.home_team.home_team_name,
        m.home_team.country?.name ?? null,
      );
      const awayTeamId = await teamId(
        m.away_team.away_team_id,
        m.away_team.away_team_name,
        m.away_team.country?.name ?? null,
      );
      await upsertMatch(client, {
        seasonId: seasonDbId,
        externalId: String(m.match_id),
        homeTeamId,
        awayTeamId,
        kickoffAt: toKickoff(m.match_date, m.kick_off),
        status: toMatchStatus(m),
        homeScore: m.home_score ?? null,
        awayScore: m.away_score ?? null,
        runId,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
