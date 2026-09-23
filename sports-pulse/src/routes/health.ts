import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../database/pool.js';

interface HealthOptions {
  db: Pick<Database, 'ping'>;
}

export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (app, { db }) => {
  // Liveness: el proceso responde. No toca dependencias.
  app.get('/health/live', async () => ({ status: 'ok' }));

  // Readiness: puede atender trafico (dependencias criticas disponibles).
  app.get('/health/ready', async (req, reply) => {
    try {
      await db.ping();
      return { status: 'ready', checks: { postgres: 'up' } };
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed');
      return reply.status(503).send({ status: 'not_ready', checks: { postgres: 'down' } });
    }
  });
};
