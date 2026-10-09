import type { QueryResult, QueryResultRow } from 'pg';

/** Lo minimo que necesitan los repositorios de Pool y PoolClient (permite usar transacciones y fakes en tests). */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}
