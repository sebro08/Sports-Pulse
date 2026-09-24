# ADR-001: Monolito modular en lugar de monorepo o microservicios

## Context
SportsPulse tiene un unico proceso desplegable (API) y un CLI de ingestion que comparte
codigo y base de datos con la API. No existe frontend en el MVP y el roadmap descarta
arquitecturas distribuidas innecesarias.

## Decision
Un solo paquete organizado por modulos de negocio (`src/modules/*`) mas codigo transversal
(`src/shared/*`). Las fronteras se hacen cumplir con reglas de ESLint (`no-restricted-imports`):
- `shared/` no importa de `modules/`.
- Un modulo no importa de otro; se componen en `app.ts` o se comunican via `shared/`.

Los ADR se numeran cronologicamente; los ADR planificados en el roadmap (PostgreSQL, Redis,
Container Apps...) se crean con el siguiente numero libre cuando se tome cada decision.

## Alternatives
- Organizar por capa tecnica (`controllers/`, `services/`, `repositories/`): mezcla dominios distintos.
- Monorepo con workspaces (`apps/api`, `apps/web`, `packages/*`): util con 2+ aplicaciones
  desplegables; hoy anade configuracion (tsconfig, Docker, CI por paquete) sin beneficio.
- Microservicios: complejidad operativa injustificada para este alcance.

## Consequences
- Bajo coste operativo y de CI hoy.
- Limites de dependencia verificados automaticamente en CI (`npm run lint`).
- Cuando exista un frontend o un worker independiente, migrar a `apps/` + `packages/` es
  mecanico porque los modulos ya estan aislados.
