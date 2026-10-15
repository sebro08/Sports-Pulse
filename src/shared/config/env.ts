import { z } from 'zod';

/** `VAR=` (vacia, como en .env.example) cuenta como "no definida", no como un valor invalido. */
const optional = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), inner.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DOCS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  REDIS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  CACHE_TTL_LIST_SECONDS: z.coerce.number().int().min(1).default(60),
  CACHE_TTL_DETAIL_SECONDS: z.coerce.number().int().min(1).default(120),
  // Auth: AUTH_JWKS_URL (produccion, p. ej. Entra ID) o AUTH_JWT_SECRET (local). Sin
  // ninguno, las rutas protegidas quedan CERRADAS (401), nunca abiertas.
  AUTH_JWT_SECRET: optional(z.string().min(32, 'must be at least 32 characters')),
  AUTH_JWKS_URL: optional(z.string().url().startsWith('https://')),
  AUTH_ISSUER: z.string().min(1).default('sports-pulse-local'),
  AUTH_AUDIENCE: z.string().min(1).default('sports-pulse-api'),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  // Detras de un proxy/ingress (Azure Container Apps), la IP real viene en X-Forwarded-For.
  // Solo activar si HAY un proxy de confianza delante: si no, un cliente podria falsificar su IP.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().default(5432),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
});

export type Env = z.infer<typeof schema>;

/** Config de auth derivada del entorno; `undefined` = auth no configurada (rutas protegidas cerradas). */
export function authConfig(env: Env) {
  if (!env.AUTH_JWKS_URL && !env.AUTH_JWT_SECRET) return undefined;
  return {
    issuer: env.AUTH_ISSUER,
    audience: env.AUTH_AUDIENCE,
    ...(env.AUTH_JWKS_URL ? { jwksUrl: env.AUTH_JWKS_URL } : { secret: env.AUTH_JWT_SECRET }),
  };
}

/** Valida las variables de entorno. Solo reporta NOMBRES invalidos, nunca valores. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const keys = Object.keys(result.error.flatten().fieldErrors).join(', ');
    throw new Error(`Invalid or missing environment variables: ${keys}`);
  }
  return result.data;
}
