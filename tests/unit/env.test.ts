import { describe, expect, it } from 'vitest';
import { authConfig, loadEnv } from '../../src/shared/config/env.js';

const base = {
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'sp',
  DATABASE_USER: 'sp',
  DATABASE_PASSWORD: 'x',
};

describe('config de auth', () => {
  it('variables vacias (como en .env.example) = auth no configurada, no un error', () => {
    const env = loadEnv({ ...base, AUTH_JWT_SECRET: '', AUTH_JWKS_URL: '' });
    expect(authConfig(env)).toBeUndefined();
  });

  it('rechaza un secreto corto, sin mostrar su valor en el error', () => {
    expect(() => loadEnv({ ...base, AUTH_JWT_SECRET: 'short-secret' })).toThrow(/AUTH_JWT_SECRET/);
    expect(() => loadEnv({ ...base, AUTH_JWT_SECRET: 'short-secret' })).not.toThrow(/short-secret/);
  });

  it('JWKS solo por https y con prioridad sobre el secreto', () => {
    expect(() => loadEnv({ ...base, AUTH_JWKS_URL: 'http://idp.local/keys' })).toThrow();
    const env = loadEnv({
      ...base,
      AUTH_JWKS_URL: 'https://login.microsoftonline.com/tenant/discovery/v2.0/keys',
      AUTH_JWT_SECRET: 'a'.repeat(32),
    });
    expect(authConfig(env)).toEqual({
      issuer: 'sports-pulse-local',
      audience: 'sports-pulse-api',
      jwksUrl: 'https://login.microsoftonline.com/tenant/discovery/v2.0/keys',
    });
  });
});
