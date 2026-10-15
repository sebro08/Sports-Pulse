# Guía del proyecto (notas de estudio)

Documento para entender **por qué** el proyecto está construido así. Está en español a propósito: es material
de repaso personal para entrevistas; la documentación pública está en inglés.

## 1. La ruta seguida

Se avanzó por **rebanadas verticales**: dato real → exponerlo → acelerarlo → protegerlo → desplegarlo.
Infraestructura sin nada que desplegar sería teatro.

| Etapa | Estado |
|---|---|
| Fase 0-3: decisiones, repo, esquema mínimo, backend base, Docker, CI | Hecho |
| Fase 13 (adelantada): ingestión robusta con StatsBomb | Hecho |
| Estructura modular con fronteras (ADR-001) | Hecho |
| Fase 4: API de lectura + OpenAPI (ADR-002) | Hecho |
| Redis cache-aside con degradación elegante (ADR-003) | Hecho |
| Auth JWT + RBAC + rate limiting (ADR-004) | Hecho |
| Endpoint admin de ingesta asíncrono + invalidación de caché por versión (ADR-005) | Hecho |
| Terraform/Azure, CI/CD completo, observabilidad, k6, pruebas de fallos | Pendiente |

## 2. Qué hace cada pieza

**Regla de dependencia:** entrada (`routes`/`cli`) → servicio → repositorio. Cada capa solo conoce a la de abajo.

| Archivo | Responsabilidad | Decisión detrás |
|---|---|---|
| `shared/config/env.ts` | Valida variables de entorno con Zod | Fail fast; los errores muestran nombres, nunca valores |
| `shared/database/pool.ts` | Pool `pg`, timeouts, parser de `bigint`→number, interfaz `Database` | Límite de conexiones y `statement_timeout`; interfaz inyectable para tests |
| `shared/database/query.ts` | `where`, `orderBy`, `escapeLike`, `selectPage` | Consultas dinámicas sin interpolar datos del usuario |
| `shared/database/migrate.ts` | Aplica `db/migrations/*.sql` en transacciones | Esquema versionado y reproducible |
| `shared/http/zod-provider.ts` | Adaptador Zod↔Fastify (validación, serialización, tipos, OpenAPI) | Un esquema = validación + tipo + respuesta + docs (ADR-002) |
| `shared/http/errors.ts` | `AppError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `RateLimitError` | Errores esperados con código estable |
| `shared/http/pagination.ts` | Query de paginación y envoltorio de respuesta | Contrato uniforme para todos los listados |
| `shared/cache/*` | `wrapRedis` (nunca lanza), `cached()`, `cacheKey()`, `dataset-version.ts` | Caché que acelera pero nunca tumba la API (ADR-003/005) |
| `shared/auth/jwt.ts` | Verifica JWT con `jose`; emite tokens de desarrollo | Algoritmo, emisor, audiencia y expiración fijados (ADR-004) |
| `shared/auth/rbac.ts` | Tabla rol → permisos y `can()` | La política vive en UN lugar |
| `shared/auth/hooks.ts` | `authenticate` (¿quién eres?) y `requirePermission` (¿qué puedes?) | 401 vs 403; fail closed |
| `shared/auth/token-cli.ts` | `npm run token` | Probar en local sin un proveedor de identidad |
| `app.ts` | `buildApp(deps)`: request-id, hooks de seguridad, errores, docs, módulos | Fábrica (no singleton) para probar con dependencias falsas |
| `modules/health` | `/live` y `/ready` | Liveness no depende de la BD; readiness sí |
| `modules/catalog` | routes → service → repository de la API de lectura | Módulo de negocio aislado, público |
| `modules/ingestion` | routes (admin), http, validation, sources/statsbomb, repository, service, cli | Ver secciones 3 y 6 |

## 3. Conceptos clave y dónde se aplican

- **Idempotencia en dos niveles:** clave de corrida única + `INSERT ... ON CONFLICT DO UPDATE`.
- **Transacción:** todos los upserts de una corrida o ninguno.
- **Backoff exponencial con jitter** y `Retry-After`; solo se reintenta lo transitorio (429, 5xx, red).
- **Validar en la frontera:** lo externo se valida una vez; después se trabaja con tipos confiables.
- **Inyección de dependencias:** `db`, `fetch`, `sleep`, `cache`, `verifyToken`, `ingestion` como parámetros →
  tests rápidos y deterministas.
- **SQL seguro:** valores siempre como parámetros; `ORDER BY` desde lista blanca; comodines de `ILIKE` escapados.
- **Serialización por esquema:** solo salen los campos declarados (no se filtran columnas internas).
- **Paginación estable:** desempate por `id` en el `ORDER BY`; sin él, las páginas pueden repetir u omitir filas.
- **Liveness vs readiness:** si liveness dependiera de la BD, una caída de BD reiniciaría contenedores sanos.
- **Linaje de datos:** `matches.ingestion_run_id` dice qué corrida produjo cada fila; `triggered_by` dice quién la lanzó.
- **Anti-SSRF:** URL base fija + ids enteros validados (el body del POST rechaza campos extra como `url`).
- **Monolito modular:** fronteras verificadas por ESLint en CI.
- **Autenticación ≠ autorización:** 401 = "no sé quién eres" (falta token o es inválido); 403 = "sé quién eres,
  pero no puedes".
- **JWT:** token firmado con `sub` (quién), `roles`, `iss` (quién lo emitió), `aud` (para qué API), `exp`
  (caducidad). El servidor no guarda sesiones: verifica la firma y confía en los claims.
- **RBAC por permiso:** las rutas piden `ingestion:run`, no "ser ADMIN". Cambiar quién puede qué = una línea.
- **Fail closed:** si falta configuración de seguridad, se niega todo; nunca se abre todo.
- **Rate limiting:** contador por IP con ventana de tiempo; frena abusos baratos antes de gastar CPU o BD.
- **202 Accepted + polling:** para trabajo lento, responder "aceptado, consulta aquí" en vez de mantener la
  conexión abierta.
- **Invalidación por versión ("generational caching"):** la versión del dataset va dentro de la clave; subirla
  invalida todo de golpe en O(1).

## 4. Incidentes reales (historias para entrevista)

1. Un test atrapó que `2018-02-30` se convertía silenciosamente en `2018-03-02` (`Date.parse` "rueda" fechas).
2. El puerto 5432 estaba reservado por Windows → se parametrizó `DATABASE_PORT`.
3. Un error de sangría en el YAML dejó `ports` dentro de `environment`.
4. Las vulnerabilidades de `vitest`/`vite`/`esbuild` se resolvieron actualizando, no con `--force`.
5. `bigint` llegaba como string desde `pg`: se unificó el parseo para que tipos y JSON coincidan.
6. **El test del rate limit "fallaba" pero el código estaba bien.** El helper del test tenía
   `rateLimit = false` como parámetro por defecto y se le pasaba `undefined` explícito para "usar el default
   de la app". En JavaScript, pasar `undefined` **activa** el valor por defecto del parámetro → el rate limit
   quedaba apagado. Se depuró mirando las cabeceras reales (`x-ratelimit-limit: 5` sí aparecía) antes de
   tocar el código de producción. Lección: verificar la hipótesis con evidencia antes de "arreglar".
7. **`.env.example` habría roto el arranque.** `AUTH_JWT_SECRET=` (vacío) llega como `""`, no como "no
   definido", y fallaba `min(32)`. Se añadió un `preprocess` que trata `""` como ausente, con test.
8. **Cadena de suministro:** `@fastify/rate-limit@11.2.1` tenía solo una semana publicada; se fijó `11.2.0`
   (2,5 meses, sin vulnerabilidades). Versiones muy recientes son el vector típico de paquetes comprometidos.

## 5. Preguntas típicas de entrevista

- ¿Por qué un monolito modular y no microservicios? (ADR-001)
- ¿Cómo garantizas que reejecutar la ingestión no duplica datos?
- ¿Cómo evitas SQL injection en filtros y ordenamiento dinámicos?
- ¿Qué pasa si la fuente externa devuelve 429 o un registro inválido?
- ¿Por qué liveness y readiness son distintos?
- ¿Diferencia entre 401 y 403? ¿Por qué no le dices al cliente por qué falló su token?
- ¿Qué es el ataque `alg: none` y cómo lo evitas? (lista fija de `algorithms` en `jwtVerify`)
- ¿Por qué JWT y no API keys o sesiones? ¿Cómo revocas un JWT? (no se puede antes de `exp` → vidas cortas)
- ¿Qué pasa con el rate limit si escalas a 3 réplicas? (el store en memoria es por réplica → 3× el límite;
  solución: store en Redis o límite en el ingress)
- ¿Qué es `trust proxy` y por qué es peligroso activarlo sin proxy? (el cliente podría falsificar su IP)
- Dos admins lanzan la misma ingesta a la vez: ¿qué pasa? (claim atómico con `ON CONFLICT ... WHERE`)
- ¿Cómo invalidas toda la caché sin `KEYS *`? ¿Por qué el `INCR` va DESPUÉS del `COMMIT`?
- ¿Qué pasa si el proceso muere a mitad de una ingesta asíncrona? (queda RUNNING; reclamable a los 15 min;
  una cola real lo resolvería)

## 6. Cómo funciona y cómo replicarlo: auth + RBAC + rate limit + invalidación

### 6.1 El recorrido de un request

```
request ─► onRequest: rate limit por IP ──────────── 429 si se pasó
        ─► preValidation: authenticate ────────────── 401 si manda token inválido
        │     sin header  → req.principal = undefined (PUBLIC)
        │     token válido → req.principal = { subject, roles }
        ─► validación Zod de params/query/body ──────── 400
        ─► preHandler: requirePermission('x') ───────── 401 anónimo / 403 sin permiso
        ─► handler (service → repository)
```

El orden importa: lo más barato primero (contar en memoria) y lo más caro al final (BD). La autenticación
va antes de validar el body para no gastar trabajo en anónimos.

### 6.2 Autenticación (`shared/auth/jwt.ts` + `hooks.ts`)

1. El cliente manda `Authorization: Bearer <jwt>`.
2. `jose.jwtVerify` comprueba **firma**, **algoritmo permitido**, `iss`, `aud` y `exp` (±5 s de tolerancia).
3. Los claims se validan con Zod: `sub` obligatorio; de `roles` solo se quedan `USER`/`ADMIN`/`SYSTEM`.
4. Si algo falla: 401 genérico al cliente, motivo real al log (`"signature verification failed"`).

Dos modos con el mismo código: **HS256 + secreto** en local (el mismo secreto firma y verifica; por eso
existe `npm run token`) y **RS256 + JWKS** en producción (Entra ID firma con su clave privada; la API solo
tiene las públicas, así que no podría fabricar tokens aunque la comprometan).

### 6.3 Autorización (`shared/auth/rbac.ts`)

Una tabla `rol → permisos` y una función `can(principal, permiso)`. Sin token se evalúa como `PUBLIC`.
Las rutas solo declaran `preHandler: requirePermission('ingestion:run')`.

### 6.4 Rate limiting (`app.ts` + config por ruta)

`@fastify/rate-limit` cuenta requests por IP en una ventana (100/min). Una ruta puede endurecerlo con
`config: { rateLimit: { max: 5, timeWindow: '1 minute' } }` o excluirse con `rateLimit: false` (probes).
El `errorResponseBuilder` devuelve un `RateLimitError` para que el 429 tenga el formato de error estándar.

### 6.5 Ingesta asíncrona (`modules/ingestion/routes.ts`)

1. `claim` (rápido, síncrono): un único `INSERT ... ON CONFLICT DO UPDATE ... WHERE` decide `started`,
   `completed` o `running`. PostgreSQL bloquea la fila, así que dos requests simultáneos no pueden ganar los dos.
2. Si `started`: se lanza `execute` **sin await** y se responde `202` + `Location`. La promesa se guarda en un
   `Set` y el hook `onClose` la espera en un apagado ordenado.
3. Al terminar con datos nuevos (`COMPLETED`/`PARTIAL`) → `INCR v1:dataset-version`.

### 6.6 Invalidación por versión (`shared/cache/dataset-version.ts`)

Las claves son `v1:d<version>:<recurso>:<params>`. Tras el `INCR`, todas las lecturas construyen claves
nuevas (miss → PostgreSQL); las viejas caducan solas por TTL. Si la versión no se puede leer, se salta la
caché (mejor lento que viejo).

### 6.7 Receta para replicarlo en otro proyecto

1. Instala `jose` y `@fastify/rate-limit` con **versión exacta revisada** (`npm view <pkg> time`).
2. Crea `rbac.ts` con roles, permisos y `can()`. Escribe primero sus tests (son funciones puras).
3. Crea el verificador con `jwtVerify` fijando `algorithms`, `issuer`, `audience`, `requiredClaims`.
   Tests: válido, firma falsa, expirado, otra audiencia, `alg: none`.
4. Hooks: `authenticate` global en `preValidation`, `requirePermission` por ruta en `preHandler`.
   Declara `principal` en `FastifyRequest` (module augmentation) y usa `decorateRequest`.
5. Registra el rate limit **antes** de las rutas (usa el hook `onRoute`), con un error uniforme.
6. Variables de entorno validadas; vacías = no definidas; sin config de auth → todo protegido da 401.
7. Para trabajo lento: claim atómico en BD + `202` + endpoint de estado + esperar en `onClose`.
8. Para invalidar caché por lotes: versión en la clave + `INCR` después del `COMMIT`.
9. Prueba de punta a punta con servicios reales (sección 6.8) y documenta en un ADR.

### 6.8 Probarlo a mano en local

```bash
docker compose up -d && npm run migrate
# en .env: AUTH_JWT_SECRET=<32+ caracteres aleatorios>
npm run dev
TOKEN=$(npm run -s token -- --role ADMIN --sub seb)
USER_TOKEN=$(npm run -s token -- --role USER --sub fan)
curl -X POST localhost:3000/api/v1/ingestion -H 'content-type: application/json' -d '{"competitionId":43,"seasonId":3}'                                   # 401
curl -X POST localhost:3000/api/v1/ingestion -H "authorization: Bearer $USER_TOKEN" -H 'content-type: application/json' -d '{"competitionId":43,"seasonId":3}'  # 403
curl -i -X POST localhost:3000/api/v1/ingestion -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"competitionId":43,"seasonId":3,"idempotencyKey":"demo-1"}'  # 202 + Location
curl localhost:3000/api/v1/ingestion/<runId> -H "authorization: Bearer $TOKEN"     # COMPLETED, triggeredBy: seb
docker compose exec redis redis-cli get v1:dataset-version                         # subió en 1
for i in $(seq 1 105); do curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/v1/teams; done | sort | uniq -c   # aparecen 429
```

Resultado verificado el 2026-10-15 con PostgreSQL y Redis reales: 401/403/202 como arriba, 64 partidos
procesados, `triggered_by` guardado (`seb` por HTTP, `cli` por consola), la versión del dataset pasó de 0 a 1
(HTTP) y a 2 (CLI), la siguiente lectura usó claves `v1:d1:...`, con Redis apagado la API siguió respondiendo
y el 429 llegó con `Retry-After`.
