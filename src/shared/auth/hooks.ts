import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../http/errors.js';
import type { TokenVerifier } from './jwt.js';
import { can, type Permission, type Principal } from './rbac.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Identidad verificada; `undefined` = request anonimo (rol PUBLIC). */
    principal?: Principal;
  }
}

const BEARER = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i;

/**
 * AUTENTICACION (¿quien eres?). Hook global `onRequest`:
 *  - Sin header Authorization -> sigue como PUBLIC (el catalogo es publico).
 *  - Con header -> el token TIENE que ser valido; si no, 401. Mandar credenciales
 *    malas nunca degrada en silencio a "anonimo".
 * `verify` undefined significa que la auth no esta configurada: cualquier token se
 * rechaza y las rutas protegidas quedan cerradas (fail closed), nunca abiertas.
 */
export function authenticate(verify: TokenVerifier | undefined) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    if (header === undefined) return;

    const reject = (reason: string): never => {
      // El motivo real (firma, expiracion, audiencia...) va al log, NO al cliente:
      // decirle al atacante que parte del token fallo le ayuda a fabricar uno.
      req.log.info({ reason }, 'token rejected');
      reply.header('www-authenticate', 'Bearer');
      throw new UnauthorizedError('Invalid or expired token');
    };
    const token = BEARER.exec(header)?.[1];
    if (!token) return reject('malformed authorization header');
    if (!verify) return reject('auth not configured');
    try {
      req.principal = await verify(token);
    } catch (err) {
      reject(err instanceof Error ? err.message : 'unknown');
    }
  };
}

/** AUTORIZACION (¿que puedes hacer?). `preHandler` por ruta: 401 si es anonimo, 403 si no le alcanza. */
export function requirePermission(permission: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (can(req.principal, permission)) return;
    if (!req.principal) {
      reply.header('www-authenticate', 'Bearer');
      throw new UnauthorizedError();
    }
    req.log.warn({ subject: req.principal.subject, permission }, 'permission denied');
    throw new ForbiddenError();
  };
}
