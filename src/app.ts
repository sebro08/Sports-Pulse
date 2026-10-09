import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { catalogRoutes } from './modules/catalog/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import type { Database } from './shared/database/pool.js';
import { AppError } from './shared/http/errors.js';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from './shared/http/zod-provider.js';

export interface AppDeps {
  db: Pick<Database, 'ping' | 'query'>;
}

export interface AppOptions {
  logLevel?: string;
  /** Expone Swagger UI en /docs y la especificacion en /docs/json. */
  docs?: boolean;
}

interface Detail {
  path: string;
  message: string;
}

function validationDetails(err: FastifyError): Detail[] | undefined {
  if (err instanceof ZodError) {
    return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  }
  if (err.validation) {
    return err.validation.map((v) => ({
      path: (v.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.'),
      message: v.message ?? 'invalid value',
    }));
  }
  return undefined;
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

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Formato de error consistente; nunca filtra detalles internos en 5xx.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const send = (status: number, code: string, message: string, details?: Detail[]) =>
      reply.status(status).send({
        error: { code, message, requestId: req.id, ...(details ? { details } : {}) },
      });

    if (err instanceof AppError) return send(err.statusCode, err.code, err.message);

    const details = validationDetails(err);
    if (details) return send(400, 'VALIDATION_ERROR', 'Invalid request', details);

    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      return send(status, 'INTERNAL_ERROR', 'Internal server error');
    }
    return send(status, err.code ?? 'BAD_REQUEST', err.message);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id },
    });
  });

  // Documentacion primero: @fastify/swagger observa las rutas registradas despues.
  if (opts.docs ?? true) {
    app.register(fastifySwagger, {
      openapi: {
        openapi: '3.0.3',
        info: {
          title: 'SportsPulse API',
          version: '0.1.0',
          description:
            'Read API for football data. Source: StatsBomb Open Data (attribution required).',
        },
        tags: [{ name: 'catalog', description: 'Competitions, seasons, teams and matches' }],
      },
      transform: jsonSchemaTransform,
    });
    app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  }

  app.register(healthRoutes, { db: deps.db });
  app.register(catalogRoutes, { db: deps.db, prefix: '/api/v1' });

  return app;
}
