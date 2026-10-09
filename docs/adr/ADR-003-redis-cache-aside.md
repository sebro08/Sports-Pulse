# ADR-003: Redis cache-aside with graceful degradation, no explicit invalidation yet

## Context
The catalog read endpoints query PostgreSQL on every request. Football historical data changes
rarely (only when an ingestion run completes), so most reads are served from data that has not
changed since the last read. Caching should speed up the common case without ever making the API
depend on Redis being up.

## Decision
- **Pattern:** cache-aside. On a request, try Redis first; on miss, query PostgreSQL and populate
  the cache. Implemented once in `shared/cache/cache-aside.ts` (`cached()`), used by every catalog
  operation in `modules/catalog/service.ts`.
- **Keys:** `v1:<resource>:<sorted query params>` (`cacheKey()`), so the same filters in any order
  produce the same key, and different filters never collide.
- **TTL, not explicit invalidation:** list endpoints expire after 60s, detail endpoints after 120s
  (both configurable via env). An ingestion run does not push an invalidation signal yet. Given the
  MVP's low write frequency, a short TTL is a reasonable trade-off that avoids building pub/sub or
  pattern-based cache deletion before it is needed.
- **Graceful degradation, enforced at two levels:**
  1. `wrapRedis()` (`shared/cache/redis-cache.ts`) catches every Redis operation; a failure becomes
     "cache miss" / no-op, logged but never thrown.
  2. `cached()` wraps its own calls to the cache in try/catch as defense in depth, in case a future
     `Cache` implementation does not honor the contract.
  3. The underlying `ioredis` client gets an `on('error', ...)` listener; without it, an unhandled
     `error` event on a Node `EventEmitter` crashes the process, which would turn a Redis outage into
     a full API outage instead of a performance hit.
  4. `REDIS_ENABLED=false` swaps in `nullCache()` (always miss), so the app runs with no Redis
     dependency at all when needed (e.g. constrained local setups).
- **Health reporting:** `/health/ready` reports Redis status for observability, but only a PostgreSQL
  failure returns `503`. A Redis outage alone keeps the API ready.

## Alternatives
- **Write-through / explicit invalidation** (ingestion deletes affected keys on write): more correct
  (no stale window), but requires either a shared process between API and ingestion CLI or a
  pub/sub channel. Deferred until write-heavy endpoints exist (Phase 8/9's admin ingestion trigger).
- **No cache:** simplest, but misses the chance to demonstrate a documented, testable resilience
  pattern, and does not reduce PostgreSQL load under repeated identical queries.
- **`redis` (node-redis) instead of `ioredis`:** both are viable; `ioredis` was chosen for its
  built-in retry strategy and long track record with connection pooling.

## Consequences
- Up to a TTL window, a client can see slightly stale data right after an ingestion run. Acceptable
  for this dataset (historical results); would need revisiting for live scores.
- Redis becomes infrastructure to provision in Azure (Azure Cache for Redis) but never a hard
  dependency for correctness or uptime.
- The cache-aside logic (`cached`, `cacheKey`, `wrapRedis`) is pure enough to unit-test without a
  real Redis instance, including the specific failure mode (every operation rejecting) that proves
  graceful degradation.
