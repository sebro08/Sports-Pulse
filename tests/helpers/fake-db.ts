import type { QueryResult, QueryResultRow } from 'pg';

export interface RecordedCall {
  text: string;
  values: unknown[] | undefined;
}

export interface FakeDbOptions {
  /** Filas a devolver segun el SQL recibido. */
  rows?: (text: string, values?: unknown[]) => unknown[];
  pingFails?: boolean;
}

/** Base de datos falsa: registra cada consulta para poder inspeccionar SQL y parametros. */
export function fakeDb(options: FakeDbOptions = {}) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async ping() {
      if (options.pingFails) throw new Error('db down');
    },
    async close() {},
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      calls.push({ text, values });
      const rows = (options.rows?.(text, values) ?? []) as R[];
      return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    },
  };
}

export const isCount = (text: string): boolean => text.includes('count(*)');
