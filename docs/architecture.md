# Architecture

## Current system

```mermaid
flowchart LR
  subgraph External
    SB[StatsBomb Open Data<br/>raw.githubusercontent.com]
    CL[API clients]
  end
  subgraph SportsPulse
    CLI[Ingestion CLI]
    API[Fastify API]
    DB[(PostgreSQL)]
    RD[(Redis)]
  end
  IDP[Identity provider<br/>Entra ID / dev secret]
  SB -->|HTTPS, allow-listed URLs| CLI
  SB -->|HTTPS, allow-listed URLs| API
  CLI -->|transactional upserts| DB
  CL -->|HTTP /api/v1, /docs<br/>Bearer JWT for admin| API
  IDP -.->|issues tokens / JWKS| CL
  API -->|parameterized SQL| DB
  API <-->|cache-aside, dataset version| RD
  CLI -->|bump dataset version| RD
```

## Code organization

Modular monolith (see [ADR-001](adr/ADR-001-modular-monolith.md)).

```
src/modules/<module>/   routes -> service -> repository (dependencies point downward)
src/shared/             config, database, cache, http helpers, auth (JWT + RBAC)
```

Rules enforced by ESLint (`no-restricted-imports`):
- `shared/` never imports from `modules/`.
- A module never imports from another module; `app.ts` composes them.

| Layer | Responsibility |
|---|---|
| routes / CLI | Input adapters: declare schemas, call the service |
| service | Use cases and business rules (e.g. "team not found" -> 404) |
| repository | SQL only; parameterized; returns DTO-shaped data |

## Request flow

1. Fastify assigns a request id (`x-request-id` is accepted if valid, else generated).
2. **`onRequest` - rate limit** per client IP (`429 RATE_LIMITED`). Cheapest check first.
3. **`preValidation` - authentication** (`shared/auth/hooks.ts`): no `Authorization` header -> anonymous
   (`PUBLIC`); a header with an invalid token -> `401`; a valid token -> `req.principal = { subject, roles }`.
4. The Zod validator parses `params` / `querystring` / `body`; failures become `400 VALIDATION_ERROR`.
5. **`preHandler` - authorization** on protected routes: `requirePermission('ingestion:run')` ->
   `401` if anonymous, `403` if the roles lack the permission.
6. The service calls the repository (and the cache, for catalog reads).
7. The response is serialized **through the response schema**, so only declared fields leave the API.
8. Errors go through one handler: `{ error: { code, message, requestId, details? } }`; 5xx never leaks internals.

## Ingestion flow

Two entry points share the same service: the CLI (synchronous) and `POST /api/v1/ingestion`
(asynchronous: `202` + polling, see [ADR-005](adr/ADR-005-async-ingestion-and-cache-invalidation.md)).

```mermaid
sequenceDiagram
  participant CLI as CLI / POST /ingestion
  participant Svc as ingestion service
  participant SB as StatsBomb
  participant DB as PostgreSQL
  CLI->>Svc: claimRun(competition, season, key, triggeredBy)
  Svc->>DB: INSERT ... ON CONFLICT (atomic claim)
  alt already COMPLETED or RUNNING
    Svc-->>CLI: skipped / same runId
  else started (HTTP returns 202 here; the rest runs in background)
    Svc->>SB: GET competitions.json (retry/backoff)
    Svc->>SB: GET matches/{c}/{s}.json
    Svc->>Svc: validate each record (Zod)
    Svc->>DB: BEGIN; upserts; COMMIT
    Svc->>DB: finish run (COMPLETED / PARTIAL / FAILED)
    CLI->>CLI: if data changed: INCR dataset version (cache invalidation)
  end
```

## Trust boundaries (initial view)

| Boundary | Threats considered | Controls in place |
|---|---|---|
| Internet -> API | Malformed input, SQL injection, oversized bodies, floods | Zod validation, parameterized SQL, whitelisted sort, 1 MiB body limit, per-IP rate limit |
| Anonymous -> admin endpoints | Spoofing, privilege escalation, forged/expired tokens | JWT verification (pinned alg, iss, aud, exp), permission-based RBAC, fail closed, generic 401 messages |
| Ingestion -> external source | SSRF, malicious/invalid payloads | Fixed base URL + validated integer ids, per-record validation, timeouts |
| API -> PostgreSQL | Over-privileged access | Connection/statement timeouts (least-privilege roles planned) |

A full STRIDE threat model will live in `docs/threat-model.md`.

## Target architecture (planned)

Azure Container Apps (API + ingestion job), Azure Database for PostgreSQL Flexible Server, Azure Cache for
Redis, Blob Storage for raw payloads, Key Vault + Managed Identity for secrets, Application Insights for
telemetry; Terraform for provisioning and GitHub Actions for delivery.
