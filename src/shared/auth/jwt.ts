import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { Principal } from './rbac.js';

/**
 * Dos modos, mismo codigo de verificacion:
 *  - `secret` (HS256): desarrollo local y tests. El mismo secreto firma y verifica, por eso
 *    solo debe existir en el entorno del servidor (y en el CLI que emite tokens de prueba).
 *  - `jwksUrl` (RS256): produccion. El emisor (p. ej. Microsoft Entra ID) firma con su clave
 *    PRIVADA y publica las PUBLICAS en un endpoint JWKS; la API solo puede verificar, nunca
 *    emitir tokens. Las claves se descargan y cachean; la rotacion de claves es transparente.
 */
export interface AuthConfig {
  issuer: string;
  audience: string;
  secret?: string;
  jwksUrl?: string;
}

export type TokenVerifier = (token: string) => Promise<Principal>;

/** Roles que un token puede otorgar. PUBLIC no se emite: es lo que tiene quien NO manda token. */
const tokenRole = z.enum(['USER', 'ADMIN', 'SYSTEM']);
type TokenRole = z.infer<typeof tokenRole>;

const claimsSchema = z.object({
  sub: z.string().min(1).max(200),
  // Entra ID entrega los "app roles" en el claim `roles`, por eso se usa ese nombre.
  // Roles desconocidos se descartan en vez de rechazar el token entero.
  roles: z
    .array(z.unknown())
    .default([])
    .transform((roles) => roles.filter((r): r is TokenRole => tokenRole.safeParse(r).success)),
});

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidTokenError';
  }
}

export function createTokenVerifier(config: AuthConfig): TokenVerifier {
  let key: Uint8Array | JWTVerifyGetKey;
  let algorithms: string[];
  if (config.jwksUrl) {
    key = createRemoteJWKSet(new URL(config.jwksUrl));
    algorithms = ['RS256'];
  } else if (config.secret) {
    key = new TextEncoder().encode(config.secret);
    algorithms = ['HS256'];
  } else {
    throw new Error('auth config needs either jwksUrl or secret');
  }

  return async (token) => {
    try {
      // `algorithms` fijo bloquea el ataque clasico de JWT: un token con alg "none" o que
      // cambia RS256 por HS256 para que la clave publica se use como secreto.
      const { payload } = await jwtVerify(token, key as Uint8Array, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms,
        requiredClaims: ['exp', 'sub'],
        clockTolerance: 5,
      });
      const claims = claimsSchema.parse(payload);
      return { subject: claims.sub, roles: claims.roles };
    } catch (err) {
      throw new InvalidTokenError(err instanceof Error ? err.message : 'invalid token');
    }
  };
}

export interface DevTokenInput {
  subject: string;
  roles: string[];
  ttlSeconds: number;
}

/** Emite un token HS256. SOLO para desarrollo/tests: en produccion los tokens los emite el IdP. */
export async function signDevToken(
  config: Pick<AuthConfig, 'issuer' | 'audience'> & { secret: string },
  input: DevTokenInput,
): Promise<string> {
  return new SignJWT({ roles: input.roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.subject)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds}s`)
    .sign(new TextEncoder().encode(config.secret));
}
