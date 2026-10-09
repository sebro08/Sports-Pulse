# Guía del proyecto (notas de estudio)

Documento para entender **por qué** el proyecto está construido así. Está en español a propósito: es material
de repaso personal para entrevistas; la documentación pública está en inglés.

## 1. La ruta seguida

Se avanzó por **rebanadas verticales**: dato real → exponerlo → acelerarlo → desplegarlo. Infraestructura sin
nada que desplegar sería teatro.

| Etapa | Estado |
|---|---|
| Fase 0-3: decisiones, repo, esquema mínimo, backend base, Docker, CI | Hecho |
| Fase 13 (adelantada): ingestión robusta con StatsBomb | Hecho |
| Estructura modular con fronteras (ADR-001) | Hecho |
| Fase 4: API de lectura + OpenAPI (ADR-002) | Hecho |
| Redis, auth/RBAC, rate limiting, Terraform/Azure, CI/CD completo, observabilidad, k6, fallos | Pendiente |

## 2. Qué hace cada pieza

**Regla de dependencia:** entrada (`routes`/`cli`) → servicio → repositorio. Cada capa solo conoce a la de abajo.

| Archivo | Responsabilidad | Decisión detrás |
|---|---|---|
| `shared/config/env.ts` | Valida variables de entorno con Zod | Fail fast; los errores muestran nombres, nunca valores |
| `shared/database/pool.ts` | Pool `pg`, timeouts, parser de `bigint`→number, interfaz `Database` | Límite de conexiones y `statement_timeout`; interfaz inyectable para tests |
| `shared/database/query.ts` | `where`, `orderBy`, `escapeLike`, `selectPage` | Consultas dinámicas sin interpolar datos del usuario |
| `shared/database/migrate.ts` | Aplica `db/migrations/*.sql` en transacciones | Esquema versionado y reproducible |
| `shared/http/zod-provider.ts` | Adaptador Zod↔Fastify (validación, serialización, tipos, OpenAPI) | Un esquema = validación + tipo + respuesta + docs (ADR-002) |
| `shared/http/errors.ts` | `AppError`, `NotFoundError`, esquema de error | Errores esperados con código estable |
| `shared/http/pagination.ts` | Query de paginación y envoltorio de respuesta | Contrato uniforme para todos los listados |
| `app.ts` | `buildApp(deps)`: request-id, manejador de errores, docs, módulos | Fábrica (no singleton) para probar con dependencias falsas |
| `modules/health` | `/live` y `/ready` | Liveness no depende de la BD; readiness sí |
| `modules/catalog` | routes → service → repository de la API de lectura | Módulo de negocio aislado |
| `modules/ingestion` | http, validation, sources/statsbomb, repository, service, cli | Ver sección 3 |

## 3. Conceptos clave y dónde se aplican

- **Idempotencia en dos niveles:** clave de corrida única + `INSERT ... ON CONFLICT DO UPDATE`.
- **Transacción:** todos los upserts de una corrida o ninguno.
- **Backoff exponencial con jitter** y `Retry-After`; solo se reintenta lo transitorio (429, 5xx, red).
- **Validar en la frontera:** lo externo se valida una vez; después se trabaja con tipos confiables.
- **Inyección de dependencias:** `db`, `fetch`, `sleep`, `random` como parámetros → tests rápidos y deterministas.
- **SQL seguro:** valores siempre como parámetros; `ORDER BY` desde lista blanca; comodines de `ILIKE` escapados.
- **Serialización por esquema:** solo salen los campos declarados (no se filtran columnas internas).
- **Paginación estable:** desempate por `id` en el `ORDER BY`; sin él, las páginas pueden repetir u omitir filas.
- **Liveness vs readiness:** si liveness dependiera de la BD, una caída de BD reiniciaría contenedores sanos.
- **Linaje de datos:** `matches.ingestion_run_id` dice qué corrida produjo cada fila.
- **Anti-SSRF:** URL base fija + ids enteros validados.
- **Monolito modular:** fronteras verificadas por ESLint en CI.

## 4. Incidentes reales (historias para entrevista)

1. Un test atrapó que `2018-02-30` se convertía silenciosamente en `2018-03-02` (`Date.parse` "rueda" fechas).
2. El puerto 5432 estaba reservado por Windows → se parametrizó `DATABASE_PORT`.
3. Un error de sangría en el YAML dejó `ports` dentro de `environment`.
4. Las vulnerabilidades de `vitest`/`vite`/`esbuild` se resolvieron actualizando, no con `--force`.
5. `bigint` llegaba como string desde `pg`: se unificó el parseo para que tipos y JSON coincidan.

## 5. Preguntas típicas de entrevista

- ¿Por qué un monolito modular y no microservicios? (ADR-001)
- ¿Cómo garantizas que reejecutar la ingestión no duplica datos?
- ¿Cómo evitas SQL injection en filtros y ordenamiento dinámicos?
- ¿Qué pasa si la fuente externa devuelve 429 o un registro inválido?
- ¿Por qué liveness y readiness son distintos?
