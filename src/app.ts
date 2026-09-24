import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Database } from './database/pool.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  db: Pick<Database, 'ping'>;
}

export interface AppOptions {
  logLevel?: string;
}

export function buildApp(deps: AppDeps, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && /^[\w-]{1,64}$/.test(h) ? h : randomUUID();
    },
    bodyLimit: 1_048_576, // 1 MiB
    requestTimeout: 30_000,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Formato de error consistente; nunca filtra detalles internos en 5xx.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    reply.status(status).send({
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : (err.code ?? 'BAD_REQUEST'),
        message: status >= 500 ? 'Internal server error' : err.message,
        requestId: req.id,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id },
    });
  });

  app.register(healthRoutes, { db: deps.db });

  return app;
}
