import { z } from 'zod';

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

/** Valida las variables de entorno. Solo reporta NOMBRES invalidos, nunca valores. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const keys = Object.keys(result.error.flatten().fieldErrors).join(', ');
    throw new Error(`Invalid or missing environment variables: ${keys}`);
  }
  return result.data;
}
