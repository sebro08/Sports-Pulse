# API

Base path `/api/v1`. Interactive docs: `/docs` (OpenAPI JSON at `/docs/json`). Set `DOCS_ENABLED=false` to disable.

## Conventions

- **Pagination:** `page` (default 1, max 10000) and `pageSize` (default 20, max 100).
  Responses: `{ "data": [...], "pagination": { "page", "pageSize", "total", "totalPages" } }`.
- **Sorting:** `sort=field` ascending, `sort=-field` descending. Only documented fields are accepted.
- **Filtering:** documented query parameters; text search (`q`) is case-insensitive and literal (wildcards escaped).
- **Dates:** `from` / `to` are `YYYY-MM-DD` (UTC), both inclusive.
- **Errors:** always `{ "error": { "code", "message", "requestId", "details"? } }`.
  Codes: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `INTERNAL_ERROR` (500).
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
Admin endpoints (ingestion trigger/status) will require authentication.
