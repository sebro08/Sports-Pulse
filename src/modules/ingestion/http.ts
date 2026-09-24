/**
 * Cliente HTTP resiliente para la ingestion: timeout, reintentos con backoff exponencial
 * y jitter completo. Reintenta timeouts, errores de red, 429 y 5xx transitorios.
 * NO reintenta 400/401/403/404 ni JSON invalido.
 */

export class HttpError extends Error {
  status: number;
  retryAfterMs: number | undefined;

  constructor(status: number, url: string, retryAfterMs?: number) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  timeoutMs: 15_000,
};

export interface FetchDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return RETRYABLE_STATUS.has(err.status);
  if (err instanceof SyntaxError) return false; // JSON invalido: reintentar no lo arregla
  return true; // timeout, DNS, conexion reseteada...
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export async function fetchJson(
  url: string,
  options: Partial<RetryOptions> = {},
  deps: FetchDeps = {},
): Promise<unknown> {
  const opts = { ...DEFAULT_RETRY, ...options };
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await doFetch(url, {
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        throw new HttpError(res.status, url, parseRetryAfter(res.headers.get('retry-after')));
      }
      return await res.json();
    } catch (err) {
      if (attempt >= opts.maxAttempts || !isRetryable(err)) throw err;
      const cap = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      const delay =
        err instanceof HttpError && err.retryAfterMs !== undefined
          ? Math.min(err.retryAfterMs, opts.maxDelayMs)
          : Math.floor(random() * cap); // full jitter
      await sleep(delay);
    }
  }
}
