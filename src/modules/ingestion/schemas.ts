import { z } from 'zod';

/** Contratos HTTP del endpoint de ingesta (los de StatsBomb viven en sources/statsbomb). */

const id = z.number().int().positive().max(1_000_000);

export const ingestionRequestSchema = z
  .object({
    competitionId: id.describe('StatsBomb competition_id (see `npm run ingest -- --list`)'),
    seasonId: id.describe('StatsBomb season_id'),
    idempotencyKey: z
      .string()
      .regex(/^[\w:.-]{1,100}$/, 'letters, digits and _ : . - only (max 100)')
      .optional()
      .describe('Same key = same run. Defaults to one key per competition/season/day.'),
  })
  .strict();
export type IngestionRequest = z.infer<typeof ingestionRequestSchema>;

export const runIdParams = z.object({ id: z.string().uuid() });

const runStatus = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL']);

export const runAcceptedSchema = z.object({
  runId: z.string().uuid(),
  status: runStatus,
  /** URL para consultar el estado (patron "202 Accepted + Location"). */
  statusUrl: z.string(),
});

export const runSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  idempotencyKey: z.string(),
  status: runStatus,
  recordsProcessed: z.number().int(),
  recordsRejected: z.number().int(),
  errorMessage: z.string().nullable(),
  triggeredBy: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
