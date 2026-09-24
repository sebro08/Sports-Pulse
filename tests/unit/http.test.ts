import { describe, expect, it } from 'vitest';
import { fetchJson, HttpError } from '../../src/ingestion/http.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function sequence(...responses: Array<Response | Error>) {
  const calls = { n: 0 };
  const fn = (async () => {
    const r = responses[Math.min(calls.n++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function sleeper() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

describe('fetchJson', () => {
  it('reintenta un 503 y luego devuelve los datos', async () => {
    const { fn, calls } = sequence(json({}, 503), json({ ok: true }));
    const s = sleeper();
    const data = await fetchJson('https://x.test/a', {}, { fetch: fn, sleep: s.sleep });
    expect(data).toEqual({ ok: true });
    expect(calls.n).toBe(2);
    expect(s.delays).toHaveLength(1);
  });

  it('reintenta errores de red', async () => {
    const { fn, calls } = sequence(new TypeError('fetch failed'), json([1]));
    const data = await fetchJson('https://x.test/a', {}, { fetch: fn, sleep: sleeper().sleep });
    expect(data).toEqual([1]);
    expect(calls.n).toBe(2);
  });

  it('NO reintenta un 404', async () => {
    const { fn, calls } = sequence(json({}, 404));
    await expect(
      fetchJson('https://x.test/a', {}, { fetch: fn, sleep: sleeper().sleep }),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls.n).toBe(1);
  });

  it('se rinde tras maxAttempts', async () => {
    const { fn, calls } = sequence(json({}, 500));
    await expect(
      fetchJson('https://x.test/a', { maxAttempts: 3 }, { fetch: fn, sleep: sleeper().sleep }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls.n).toBe(3);
  });

  it('respeta Retry-After en un 429', async () => {
    const { fn } = sequence(json({}, 429, { 'retry-after': '2' }), json({ ok: true }));
    const s = sleeper();
    await fetchJson('https://x.test/a', {}, { fetch: fn, sleep: s.sleep });
    expect(s.delays).toEqual([2000]);
  });

  it('aplica backoff exponencial con jitter acotado', async () => {
    const { fn } = sequence(json({}, 503));
    const s = sleeper();
    await expect(
      fetchJson(
        'https://x.test/a',
        { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1000 },
        { fetch: fn, sleep: s.sleep, random: () => 0.999 },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(s.delays).toEqual([99, 199, 399]);
  });
});
