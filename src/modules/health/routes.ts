import type { FastifyPluginAsync } from 'fastify';
import type { Cache } from '../../shared/cache/types.js';
import type { Database } from '../../shared/database/pool.js';

interface HealthOptions {
  db: Pick<Database, 'ping'>;
  cache: Cache;
}

export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (app, { db, cache }) => {
  // Liveness: el proceso responde. No toca dependencias.
  // Sin rate limit: la plataforma (Container Apps) consulta los probes cada pocos segundos
  // desde la misma IP; limitarlos podria hacer que reinicie contenedores sanos.
  const config = { rateLimit: false };

  app.get('/health/live', { config }, async () => ({ status: 'ok' }));

  // Readiness: solo PostgreSQL es critico. Redis caido degrada rendimiento, no
  // disponibilidad, asi que se informa pero NUNCA produce un 503 por si solo.
  app.get('/health/ready', { config }, async (req, reply) => {
    const redisUp = await cache.ping();
    try {
      await db.ping();
      return { status: 'ready', checks: { postgres: 'up', redis: redisUp ? 'up' : 'down' } };
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed');
      return reply
        .status(503)
        .send({ status: 'not_ready', checks: { postgres: 'down', redis: redisUp ? 'up' : 'down' } });
    }
  });
};
