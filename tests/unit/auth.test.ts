import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createTokenVerifier, signDevToken } from '../../src/shared/auth/jwt.js';
import { can } from '../../src/shared/auth/rbac.js';
import { authConfig, bearer, tokenFor, verifyToken } from '../helpers/auth.js';
import { fakeCache } from '../helpers/fake-cache.js';
import { fakeDb, isCount } from '../helpers/fake-db.js';

const opts = { logLevel: 'silent', docs: false, rateLimit: false as const };

describe('RBAC: can()', () => {
  it('un request anonimo (PUBLIC) puede leer el catalogo pero no lanzar ingestas', () => {
    expect(can(undefined, 'catalog:read')).toBe(true);
    expect(can(undefined, 'ingestion:run')).toBe(false);
  });

  it('USER no puede lanzar ingestas; ADMIN y SYSTEM si', () => {
    expect(can({ subject: 'u', roles: ['USER'] }, 'ingestion:run')).toBe(false);
    expect(can({ subject: 'a', roles: ['ADMIN'] }, 'ingestion:run')).toBe(true);
    expect(can({ subject: 's', roles: ['SYSTEM'] }, 'ingestion:read')).toBe(true);
  });

  it('basta con que UNO de los roles tenga el permiso', () => {
    expect(can({ subject: 'x', roles: ['USER', 'ADMIN'] }, 'ingestion:run')).toBe(true);
  });

  it('un token sin roles equivale a autenticado sin privilegios', () => {
    expect(can({ subject: 'x', roles: [] }, 'ingestion:run')).toBe(false);
  });
});

describe('verificacion de JWT', () => {
  it('acepta un token valido y extrae sub y roles', async () => {
    const principal = await verifyToken(await tokenFor(['ADMIN'], 'seb'));
    expect(principal).toEqual({ subject: 'seb', roles: ['ADMIN'] });
  });

  it('descarta roles desconocidos (y PUBLIC, que no se emite) sin rechazar el token', async () => {
    const principal = await verifyToken(await tokenFor(['ADMIN', 'SUPERUSER', 'PUBLIC']));
    expect(principal.roles).toEqual(['ADMIN']);
  });

  it('rechaza un token firmado con otro secreto (falsificado)', async () => {
    const forged = await signDevToken(
      { ...authConfig, secret: 'attacker-secret-attacker-secret-attacker' },
      { subject: 'evil', roles: ['ADMIN'], ttlSeconds: 300 },
    );
    await expect(verifyToken(forged)).rejects.toThrow();
  });

  it('rechaza un token expirado', async () => {
    const expired = await new SignJWT({ roles: ['ADMIN'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('seb')
      .setIssuer(authConfig.issuer)
      .setAudience(authConfig.audience)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(authConfig.secret));
    await expect(verifyToken(expired)).rejects.toThrow();
  });

  it('rechaza un token emitido para otra audiencia o por otro emisor', async () => {
    const otherAudience = createTokenVerifier({ ...authConfig, audience: 'other-api' });
    const otherIssuer = createTokenVerifier({ ...authConfig, issuer: 'someone-else' });
    const token = await tokenFor(['ADMIN']);
    await expect(otherAudience(token)).rejects.toThrow();
    await expect(otherIssuer(token)).rejects.toThrow();
  });

  it('rechaza un token sin firma (alg: none)', async () => {
    const unsigned = new UnsecuredJWT({ roles: ['ADMIN'] })
      .setSubject('evil')
      .setIssuer(authConfig.issuer)
      .setAudience(authConfig.audience)
      .setExpirationTime('5m')
      .encode();
    await expect(verifyToken(unsigned)).rejects.toThrow();
  });
});

describe('autenticacion en la API', () => {
  const db = () => fakeDb({ rows: (t) => (isCount(t) ? [{ total: 0 }] : []) });

  it('el catalogo es publico: sin token responde 200', async () => {
    const app = buildApp({ db: db(), cache: fakeCache(), verifyToken }, opts);
    const res = await app.inject({ method: 'GET', url: '/api/v1/competitions' });
    expect(res.statusCode).toBe(200);
  });

  it('un token invalido da 401 aunque la ruta sea publica (no degrada a anonimo)', async () => {
    const app = buildApp({ db: db(), cache: fakeCache(), verifyToken }, opts);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/competitions',
      headers: bearer('not.a.validtoken'),
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    // El cliente NO recibe el motivo tecnico (firma, expiracion...): solo un mensaje generico.
    expect(res.json().error).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
    });
  });

  it('un esquema distinto de Bearer da 401', async () => {
    const app = buildApp({ db: db(), cache: fakeCache(), verifyToken }, opts);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/competitions',
      headers: { authorization: 'Basic YWRtaW46YWRtaW4=' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('sin verificador configurado, cualquier token se rechaza (fail closed)', async () => {
    const app = buildApp({ db: db(), cache: fakeCache() }, opts);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/competitions',
      headers: bearer(await tokenFor(['ADMIN'])),
    });
    expect(res.statusCode).toBe(401);
  });
});
