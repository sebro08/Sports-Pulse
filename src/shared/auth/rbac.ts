/**
 * RBAC (Role-Based Access Control). Las rutas NO preguntan "¿es ADMIN?", preguntan
 * "¿tiene el permiso X?". La tabla rol -> permisos vive SOLO aqui, asi que dar o quitar
 * una capacidad a un rol es cambiar una linea, sin tocar ninguna ruta.
 *
 *  - PUBLIC: cualquiera sin token (lecturas del catalogo).
 *  - USER:   usuario autenticado. Hoy tiene lo mismo que PUBLIC; reservado para
 *            features personales futuras (favoritos, limites mas altos).
 *  - ADMIN:  persona que opera la plataforma (lanzar y consultar ingestas).
 *  - SYSTEM: identidad de maquina (un job programado, otra app) que lanza ingestas.
 */
export const ROLES = ['PUBLIC', 'USER', 'ADMIN', 'SYSTEM'] as const;
export type Role = (typeof ROLES)[number];

export type Permission = 'catalog:read' | 'ingestion:run' | 'ingestion:read';

const GRANTS: Record<Role, readonly Permission[]> = {
  PUBLIC: ['catalog:read'],
  USER: ['catalog:read'],
  ADMIN: ['catalog:read', 'ingestion:run', 'ingestion:read'],
  SYSTEM: ['catalog:read', 'ingestion:run', 'ingestion:read'],
};

/** Identidad ya verificada del que llama (sale de un token valido, nunca del cliente sin firmar). */
export interface Principal {
  /** Claim `sub` del token: quien es (usuario o identidad de maquina). */
  subject: string;
  roles: Role[];
}

/** Un request sin token se evalua como PUBLIC. Basta con que UNO de los roles tenga el permiso. */
export function can(principal: Principal | undefined, permission: Permission): boolean {
  const roles: readonly Role[] = principal?.roles ?? ['PUBLIC'];
  return roles.some((role) => GRANTS[role].includes(permission));
}
