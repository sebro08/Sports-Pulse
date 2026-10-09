# ADR-001: Modular monolith instead of monorepo or microservices

## Context
SportsPulse has one deployable API process plus an ingestion CLI that shares code and database with it.
There is no frontend in the MVP, and the roadmap explicitly avoids unnecessary distributed complexity.

## Decision
Single package organized by business module (`src/modules/*`) plus cross-cutting code (`src/shared/*`).
Boundaries are enforced with ESLint `no-restricted-imports`:
- `shared/` does not import from `modules/`.
- A module does not import from another module; they are composed in `app.ts` or communicate via `shared/`.

ADRs are numbered chronologically; decisions planned in the roadmap (PostgreSQL, Redis, Container Apps, ...)
get the next free number when each decision is made.

## Alternatives
- Layer-first folders (`controllers/`, `services/`, `repositories/`): mixes unrelated domains.
- Monorepo with workspaces (`apps/api`, `apps/web`, `packages/*`): worthwhile with 2+ deployable apps; today
  it only adds per-package tsconfig/Docker/CI overhead.
- Microservices: operational cost not justified at this scope.

## Consequences
- Low operational and CI cost now; dependency limits verified automatically in CI (`npm run lint`).
- When a frontend or an independent worker appears, moving to `apps/` + `packages/` is mechanical because
  modules are already isolated.
