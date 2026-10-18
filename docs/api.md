# API

Base path `/api/v1`. Interactive docs: `/docs` (OpenAPI JSON at `/docs/json`). Set `DOCS_ENABLED=false` to disable.

## Conventions

- **Pagination:** `page` (default 1, max 10000) and `pageSize` (default 20, max 100).
  Responses: `{ "data": [...], "pagination": { "page", "pageSize", "total", "totalPages" } }`.
- **Sorting:** `sort=field` ascending, `sort=-field` descending. Only documented fields are accepted.
- **Filtering:** documented query parameters; text search (`q`) is case-insensitive and literal (wildcards escaped).
- **Dates:** `from` / `to` are `YYYY-MM-DD` (UTC), both inclusive.
- **Errors:** always `{ "error": { "code", "message", "requestId", "details"? } }`.
  Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
  `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).
- **Authentication:** catalog endpoints are public. Admin endpoints need `Authorization: Bearer <JWT>`
  (see [Authentication](#authentication)). Sending an invalid token returns `401` on any endpoint.
- **Rate limiting:** per client IP, 100 requests/minute by default. Every response carries
  `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`; a `429` also carries `Retry-After`.
  `/health/*` is not limited.
- **Request id:** send `x-request-id` (alphanumeric, `_`, `-`, max 64) or one is generated; it is echoed in the response header and error body.

## Endpoints

| Path | Query parameters | Sort fields |
|---|---|---|
| `GET /competitions` | `q`, `country` | `name` (default), `country`, `id` |
| `GET /seasons` | `competitionId` | `-name` (default), `name`, `id` |
| `GET /teams` | `q`, `country` | `name` (default), `country`, `id` |
| `GET /teams/:id` | - | - |
| `GET /matches` | `seasonId`, `teamId`, `status`, `from`, `to` | `kickoff` (default), `id` |
| `GET /matches/:id` | - | - |

`status`: `SCHEDULED`, `LIVE`, `FINISHED`, `POSTPONED`, `CANCELLED`.

### Admin: ingestion

| Method & path | Permission (roles) | Responses |
|---|---|---|
| `POST /ingestion` | `ingestion:run` (ADMIN, SYSTEM) | `202` started or already running, `200` already completed, `400`, `401`, `403`, `429` |
| `GET /ingestion/:id` | `ingestion:read` (ADMIN, SYSTEM) | `200`, `400` (not a UUID), `401`, `403`, `404` |

`POST` body: `{ "competitionId": int, "seasonId": int, "idempotencyKey"?: string }` (unknown fields are
rejected; key: letters, digits, `_ : . -`, max 100). It is **asynchronous**: the response contains
`runId` and `statusUrl` (also in the `Location` header) to poll until `status` is `COMPLETED`, `PARTIAL`
or `FAILED`. It is **idempotent**: the same key returns the same run instead of starting another one.
Limited to 5 calls/minute per IP. When a run writes data, the catalog cache is invalidated
([ADR-005](adr/ADR-005-async-ingestion-and-cache-invalidation.md)).

## Authentication

Bearer JWTs ([ADR-004](adr/ADR-004-auth-rbac-rate-limiting.md)). Required claims: `sub`, `exp`,
`iss` = `AUTH_ISSUER`, `aud` = `AUTH_AUDIENCE`; roles in the `roles` array claim (`USER`, `ADMIN`,
`SYSTEM`; others are ignored).

| Role | How you get it | Can |
|---|---|---|
| `PUBLIC` | no token | read the catalog |
| `USER` | token with `roles: ["USER"]` | same as PUBLIC (reserved for personal features) |
| `ADMIN` | token with `roles: ["ADMIN"]` | catalog + start and inspect ingestion runs |
| `SYSTEM` | token for a machine identity | same as ADMIN (scheduled jobs, other services) |

Locally, mint a token signed with `AUTH_JWT_SECRET`:

```bash
TOKEN=$(npm run -s token -- --role ADMIN --sub your-name)
curl -X POST http://localhost:3000/api/v1/ingestion \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"competitionId":43,"seasonId":3}'
curl http://localhost:3000/api/v1/ingestion/<runId> -H "Authorization: Bearer $TOKEN"
```

In production tokens come from the identity provider (`AUTH_JWKS_URL`, e.g. Microsoft Entra ID).
In Swagger UI (`/docs`), use **Authorize** to paste a token.

## Examples

```bash
curl "http://localhost:3000/api/v1/competitions?q=world&sort=-name"
curl "http://localhost:3000/api/v1/matches?seasonId=1&status=FINISHED&pageSize=5"
curl "http://localhost:3000/api/v1/matches?teamId=12&from=2018-06-14&to=2018-06-30"
curl "http://localhost:3000/api/v1/teams/1"
```

Error example (`GET /api/v1/matches?pageSize=1000`):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "requestId": "9b3c...",
    "details": [{ "path": "pageSize", "message": "Number must be less than or equal to 100" }]
  }
}
```

## Not exposed

Internal identifiers and lineage (`external_id`, `ingestion_run_id`, `source_id`) are not part of the public contract.
`GET /ingestion/:id` exposes run metadata (INTERNAL data) only to ADMIN / SYSTEM.
