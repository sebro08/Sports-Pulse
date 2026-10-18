import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { CacheTtl } from './modules/catalog/service.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { ingestionRoutes } from './modules/ingestion/routes.js';
import type { IngestionRunner } from './modules/ingestion/service.js';
import { authenticate } from './shared/auth/hooks.js';
import type { TokenVerifier } from './shared/auth/jwt.js';
import type { Cache } from './shared/cache/types.js';
import type { Database } from './shared/database/pool.js';
import { AppError, RateLimitError } from './shared/http/errors.js';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from './shared/http/zod-provider.js';

export interface AppDeps {
  db: Pick<Database, 'ping' | 'query'>;
  cache: Cache;
  cacheTtl?: CacheTtl;
  /** Verifica tokens Bearer. Sin el, la auth queda "cerrada": toda ruta protegida responde 401. */
  verifyToken?: TokenVerifier;
  /** Ejecuta ingestas. Sin el, los endpoints /api/v1/ingestion no se registran. */
  ingestion?: IngestionRunner;
}

export interface AppOptions {
  logLevel?: string;
  /** Expone Swagger UI en /docs y la especificacion en /docs/json. */
  docs?: boolean;
  /** Limite global por IP; `false` lo desactiva (p. ej. en tests que no lo prueban). */
  rateLimit?: { max: number; windowSeconds: number } | false;
  /** Confiar en X-Forwarded-For (solo detras de un proxy/ingress de confianza). */
  trustProxy?: boolean;
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
    trustProxy: opts.trustProxy ?? false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Orden de defensa en cada request (ver docs/security.md):
  //   onRequest     -> rate limit por IP (lo mas barato primero: frena abuso antes de gastar CPU)
  //   preValidation -> autenticacion (verifica el token si viene; si no, request PUBLIC)
  //   validation    -> Zod sobre params/query/body
  //   preHandler    -> autorizacion por ruta (requirePermission)
  app.decorateRequest('principal', undefined);
  app.addHook('preValidation', authenticate(deps.verifyToken));

  const rateLimit = opts.rateLimit ?? { max: 100, windowSeconds: 60 };
  if (rateLimit) {
    app.register(fastifyRateLimit, {
      max: rateLimit.max,
      timeWindow: rateLimit.windowSeconds * 1000,
      // Se lanza como AppError para que la respuesta 429 tenga el mismo formato que el resto.
      errorResponseBuilder: (_req, ctx) => new RateLimitError(ctx.after),
    });
  }

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
        tags: [
          { name: 'catalog', description: 'Competitions, seasons, teams and matches (public)' },
          { name: 'ingestion', description: 'Admin: trigger and inspect ingestion runs' },
        ],
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
      },
      transform: jsonSchemaTransform,
    });
    app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  }

  const ttl = deps.cacheTtl ?? { list: 60, detail: 120 };

  app.register(healthRoutes, { db: deps.db, cache: deps.cache });
  app.register(catalogRoutes, { db: deps.db, cache: deps.cache, ttl, prefix: '/api/v1' });
  if (deps.ingestion) {
    app.register(ingestionRoutes, {
      db: deps.db,
      cache: deps.cache,
      runner: deps.ingestion,
      prefix: '/api/v1',
    });
  }

  return app;
}
