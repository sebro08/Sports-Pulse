import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../shared/auth/hooks.js';
import { bumpDatasetVersion } from '../../shared/cache/dataset-version.js';
import type { Cache } from '../../shared/cache/types.js';
import type { Queryable } from '../../shared/database/queryable.js';
import { errorResponseSchema, NotFoundError } from '../../shared/http/errors.js';
import type { ZodTypeProvider } from '../../shared/http/zod-provider.js';
import { findRun } from './repository.js';
import { ingestionRequestSchema, runAcceptedSchema, runIdParams, runSchema } from './schemas.js';
import { changedData, type IngestionRunner } from './service.js';

export interface IngestionRouteOptions {
  db: Queryable;
  cache: Cache;
  runner: IngestionRunner;
}

const tags = ['ingestion'];
const security = [{ bearerAuth: [] }];
const authErrors = { 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema };

export const ingestionRoutes: FastifyPluginAsync<IngestionRouteOptions> = async (
  app,
  { db, cache, runner },
) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Corridas en segundo plano. En un apagado ordenado (SIGTERM) se espera a que terminen
  // ANTES de cerrar el pool de PostgreSQL; si no, quedarian a medias en estado RUNNING.
  const inFlight = new Set<Promise<void>>();
  app.addHook('onClose', async () => {
    await Promise.allSettled(inFlight);
  });

  r.post(
    '/ingestion',
    {
      preHandler: requirePermission('ingestion:run'),
      // Mas estricto que el limite global: cada llamada sale a internet y escribe en la BD.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags,
        security,
        summary: 'Start an ingestion run (ADMIN / SYSTEM)',
        description:
          'Asynchronous: returns 202 with the run id; poll `statusUrl`. Idempotent: the same ' +
          'idempotencyKey returns the existing run (200 if it already completed).',
        body: ingestionRequestSchema,
        response: {
          200: runAcceptedSchema,
          202: runAcceptedSchema,
          400: errorResponseSchema,
          ...authErrors,
        },
      },
    },
    async (req, reply) => {
      const params = { ...req.body, triggeredBy: req.principal?.subject ?? 'unknown' };
      const run = await runner.claim(params);
      const statusUrl = `/api/v1/ingestion/${run.runId}`;
      req.log.info({ runId: run.runId, claim: run.claim, ...params }, 'ingestion requested');

      if (run.claim === 'completed') {
        return reply.status(200).send({ runId: run.runId, status: 'COMPLETED', statusUrl });
      }
      if (run.claim === 'started') {
        const job = runner
          .execute(run, params)
          .then(async (result) => {
            if (!changedData(result)) return;
            const version = await bumpDatasetVersion(cache);
            req.log.info({ runId: run.runId, datasetVersion: version }, 'catalog cache invalidated');
          })
          .catch((err: unknown) => req.log.error({ err, runId: run.runId }, 'ingestion job crashed'))
          .finally(() => inFlight.delete(job));
        inFlight.add(job);
      }
      // 'started' o 'running' (otra peticion ya la esta ejecutando): mismo runId, mismo 202.
      return reply.status(202).header('location', statusUrl).send({ runId: run.runId, status: 'RUNNING', statusUrl });
    },
  );

  r.get(
    '/ingestion/:id',
    {
      preHandler: requirePermission('ingestion:read'),
      schema: {
        tags,
        security,
        summary: 'Get an ingestion run (ADMIN / SYSTEM)',
        params: runIdParams,
        response: { 200: runSchema, 400: errorResponseSchema, 404: errorResponseSchema, ...authErrors },
      },
    },
    async (req) => {
      const run = await findRun(db, req.params.id);
      if (!run) throw new NotFoundError('Ingestion run');
      return run;
    },
  );
};
