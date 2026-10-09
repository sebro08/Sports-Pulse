import { describe, expect, it } from 'vitest';
import { escapeLike, orderBy, where } from '../../src/shared/database/query.js';

describe('where', () => {
  it('numera parametros y omite condiciones vacias', () => {
    const w = where([{ sql: 'a = ?', value: 1 }, undefined, { sql: '(b = ? OR c = ?)', value: 'x' }]);
    expect(w.clause).toBe('WHERE a = $1 AND (b = $2 OR c = $2)');
    expect(w.params).toEqual([1, 'x']);
  });

  it('sin condiciones no genera WHERE', () => {
    expect(where([undefined]).clause).toBe('');
  });
});

describe('escapeLike', () => {
  it('escapa comodines y la barra invertida', () => {
    expect(escapeLike('50%_\\')).toBe('50\\%\\_\\\\');
  });
});

describe('orderBy', () => {
  const columns = { name: 'c.name' };

  it('soporta ascendente y descendente con desempate por id', () => {
    expect(orderBy('name', columns, 'c.id')).toBe('ORDER BY c.name ASC, c.id ASC');
    expect(orderBy('-name', columns, 'c.id')).toBe('ORDER BY c.name DESC, c.id ASC');
  });

  it('rechaza columnas fuera de la lista blanca', () => {
    expect(() => orderBy('password', columns, 'c.id')).toThrow();
    expect(() => orderBy('name; DROP TABLE teams', columns, 'c.id')).toThrow();
  });
});
