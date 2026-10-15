# ADR-005: Asynchronous ingestion endpoint and version-based cache invalidation

## Context
Ingestion could only be started from the CLI. Operators and scheduled jobs need an HTTP trigger
(`POST /api/v1/ingestion`) and a way to check the outcome. A run takes seconds and can take much
longer if StatsBomb is slow (retries with backoff), so holding the HTTP request open is fragile.
ADR-003 accepted TTL-only staleness "until an admin ingestion trigger exists" — it now exists.

## Decision
- **202 Accepted + polling.** `POST /api/v1/ingestion` does the quick part synchronously — claim the
  run in PostgreSQL — and returns `202` with `runId`, a `Location` header and `statusUrl`. The slow
  part (download, validate, persist) runs in the background inside the API process.
  `GET /api/v1/ingestion/:id` reports status, counts, error and `triggeredBy`.
- **Atomic run claim** (`startRun` in `modules/ingestion/repository.ts`): one
  `INSERT ... ON CONFLICT DO UPDATE ... WHERE` decides between `started`, `completed` (same key already
  succeeded → `200`, nothing runs) and `running` (same key in progress → `202` with the *same* run id).
  PostgreSQL row locking makes concurrent duplicates impossible without manual locks. A `RUNNING` run
  older than 15 minutes is treated as abandoned and can be reclaimed.
- **Audit trail:** `ingestion_runs.triggered_by` (migration `002`) stores the token's `sub`, or `cli`.
- **Graceful shutdown:** in-flight runs are tracked and awaited in Fastify's `onClose` hook, before the
  PostgreSQL pool is closed.
- **Version-based ("generational") cache invalidation:** every catalog cache key embeds a dataset
  version stored in Redis (`v1:dataset-version`), e.g. `v1:d7:teams:...`. When a run commits data
  (`COMPLETED` / `PARTIAL`) its caller — the HTTP route or the CLI — runs `INCR`, so all catalog keys
  change at once in O(1). Old keys are never read again and expire through their TTL.
  - The bump happens **after COMMIT**, so any reader that sees the new version also sees the new data.
  - If the version can't be read (Redis down), the catalog bypasses the cache instead of guessing a
    version and possibly serving pre-ingestion data.
  - `FAILED` runs (rolled back) and skipped runs don't invalidate anything.

## Alternatives
- **Synchronous endpoint (200 when done):** simpler, but ties a client connection, proxies' timeouts
  and our 30s `requestTimeout` to an external dependency's latency.
- **Real job queue (Azure Service Bus / Container Apps Jobs / BullMQ):** survives process crashes and
  scales independently. The right call once deployed; today it adds infrastructure without a
  measurable benefit. The `IngestionRunner` interface is the seam where a queue would plug in.
- **Delete affected keys (`SCAN` + `DEL` by pattern):** O(keys), racy with concurrent readers, and
  `KEYS`/`SCAN` on a shared Redis is an operational smell.
- **Pub/sub invalidation:** needs a subscriber in every API replica; overkill for one writer.

## Consequences
- If the API process dies mid-run, the run stays `RUNNING` until the 15-minute staleness window lets
  the same key be retried. A queue would remove this gap.
- One extra Redis `GET` (the version) per catalog request. Sub-millisecond on the same network; can be
  memoized in-process for a second if metrics ever show it matters.
- If the `INCR` fails (Redis down at that moment), data stays stale until TTL — the TTL from ADR-003
  remains the safety net.
- ADR-003's "TTL only, no active invalidation" is superseded by this ADR; its degradation rules still hold.
