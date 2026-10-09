import type { QueryResultRow } from 'pg';
import type { Queryable } from './queryable.js';

/**
 * Helpers para construir consultas dinamicas SIN interpolar datos del usuario:
 *  - los VALORES siempre viajan como parametros ($1, $2...)
 *  - las columnas de ORDER BY salen de una lista blanca definida en el codigo
 */

export interface Condition {
  /** Fragmento SQL con uno o mas '?' que se sustituyen por el mismo parametro. */
  sql: string;
  value: unknown;
}

export interface WhereClause {
  clause: string;
  params: unknown[];
}

export function where(conditions: Array<Condition | undefined>): WhereClause {
  const params: unknown[] = [];
  const parts: string[] = [];
  for (const c of conditions) {
    if (!c) continue;
    params.push(c.value);
    parts.push(c.sql.replaceAll('?', `$${params.length}`));
  }
  return { clause: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '', params };
}

/** Escapa los comodines de LIKE/ILIKE para que el texto del usuario se busque literalmente. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/** `sort` = "campo" (asc) o "-campo" (desc). Solo acepta columnas de la lista blanca. */
export function orderBy(
  sort: string,
  columns: Record<string, string>,
  tieBreaker: string,
): string {
  const desc = sort.startsWith('-');
  const column = columns[desc ? sort.slice(1) : sort];
  if (!column) throw new Error(`unsupported sort: ${sort}`);
  // Desempate por id: sin el, la paginacion puede repetir u omitir filas.
  return `ORDER BY ${column} ${desc ? 'DESC' : 'ASC'}, ${tieBreaker} ASC`;
}

export interface PageOptions {
  select: string;
  from: string;
  /** FROM mas simple para el COUNT (sin joins innecesarios). */
  countFrom?: string;
  where: WhereClause;
  order: string;
  page: number;
  pageSize: number;
}

export async function selectPage<R extends QueryResultRow>(
  db: Queryable,
  o: PageOptions,
): Promise<{ rows: R[]; total: number }> {
  const n = o.where.params.length;
  const dataSql = `SELECT ${o.select} FROM ${o.from} ${o.where.clause} ${o.order} LIMIT $${n + 1} OFFSET $${n + 2}`;
  const countSql = `SELECT count(*) AS total FROM ${o.countFrom ?? o.from} ${o.where.clause}`;
  const [data, count] = await Promise.all([
    db.query<R>(dataSql, [...o.where.params, o.pageSize, (o.page - 1) * o.pageSize]),
    db.query<{ total: number | string }>(countSql, o.where.params),
  ]);
  return { rows: data.rows, total: Number(count.rows[0]?.total ?? 0) };
}
