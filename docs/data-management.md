# Data management

## Source: StatsBomb Open Data
- Origin: https://github.com/statsbomb/open-data (public JSON files).
- **Attribution required:** when publishing analysis or demos based on this data, credit StatsBomb as the
  source and use their logo per their user agreement. Keep this notice in the README and any demo.
- Use: personal portfolio / research project. Re-check their terms before any public release.

## Classification
| Data | Class | Exposed by API |
|---|---|---|
| Competitions, seasons, teams, matches | PUBLIC | Yes |
| `ingestion_runs`, `ingestion_run_id`, `external_id` | INTERNAL | Runs only to ADMIN / SYSTEM (`GET /api/v1/ingestion/:id`) |
| Token subjects (`triggered_by`) | INTERNAL | Same as above; never logged with the token itself |
| Database credentials, `AUTH_JWT_SECRET`, tokens | SECRET | Never (Key Vault in production; `Authorization` is redacted from logs) |

No personal data is stored. Only what the MVP needs is ingested (no events or line-ups yet).

## Ingestion
- Entry points: `npm run ingest` (CLI) and `POST /api/v1/ingestion` (ADMIN / SYSTEM, asynchronous).
  Both record who started the run in `ingestion_runs.triggered_by`.
- Flow: catalog -> matches -> per-record Zod validation -> single transaction -> upserts.
- **Idempotent:** `UNIQUE(source_id, idempotency_key)` + `ON CONFLICT DO UPDATE`. A COMPLETED run with the same
  key is skipped; FAILED/PARTIAL runs are retried; a RUNNING run blocks duplicates (stale after 15 min).
- Default key: `statsbomb:c{competition}:s{season}:{date}`; override with `--key`.
- States: RUNNING -> COMPLETED | PARTIAL (some records rejected) | FAILED.
- HTTP resilience: timeout, exponential backoff with jitter, `Retry-After` honored; retries only timeouts,
  network errors, 429 and 502/503/504/500; never 4xx or invalid JSON.
- Anti-SSRF: URLs are built from a fixed base and validated integer ids; users cannot supply URLs.

## Known limitations
- `kickoff_at`: the source gives local stadium time without a timezone; it is stored as UTC (approximation).
- Rejected records are logged and counted (`records_rejected`) but not yet persisted.
- Raw payloads are not yet archived to Blob Storage; no circuit breaker yet.
