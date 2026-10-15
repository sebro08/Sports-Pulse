import { parseArgs } from 'node:util';
import { loadEnv } from '../config/env.js';
import { signDevToken } from './jwt.js';

/**
 * Emite un token de DESARROLLO firmado con AUTH_JWT_SECRET para probar la API en local:
 *   npm run token -- --role ADMIN --sub seb
 * En produccion no se usa: los tokens los emite el proveedor de identidad (Entra ID).
 */
const { values } = parseArgs({
  options: {
    role: { type: 'string', multiple: true, default: ['ADMIN'] },
    sub: { type: 'string', default: 'local-dev' },
    ttl: { type: 'string', default: '3600' },
  },
});

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') throw new Error('dev tokens are disabled in production');
  if (!env.AUTH_JWT_SECRET) throw new Error('AUTH_JWT_SECRET is not set in .env');
  const ttlSeconds = Number(values.ttl);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) {
    throw new Error('--ttl must be an integer between 1 and 86400 seconds');
  }
  const token = await signDevToken(
    { secret: env.AUTH_JWT_SECRET, issuer: env.AUTH_ISSUER, audience: env.AUTH_AUDIENCE },
    { subject: values.sub, roles: values.role.map((r) => r.toUpperCase()), ttlSeconds },
  );
  console.log(token);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
