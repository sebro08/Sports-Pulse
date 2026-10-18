import { createTokenVerifier, signDevToken } from '../../src/shared/auth/jwt.js';

export const authConfig = {
  issuer: 'sports-pulse-test',
  audience: 'sports-pulse-api',
  secret: 'test-secret-that-is-at-least-32-characters-long',
};

export const verifyToken = createTokenVerifier(authConfig);

export function tokenFor(roles: string[], subject = 'tester', ttlSeconds = 300): Promise<string> {
  return signDevToken(authConfig, { subject, roles, ttlSeconds });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
