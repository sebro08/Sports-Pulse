# ADR-004: JWT bearer auth, permission-based RBAC and per-IP rate limiting

## Context
The API needs its first write-capable endpoint (triggering an ingestion run). It makes outbound
HTTP calls and writes to PostgreSQL, so it must be restricted to operators and automated jobs, while
the catalog stays public. Before deploying anything to the internet we also need a basic defense
against request floods. The target platform is Azure, where identities normally come from
Microsoft Entra ID.

## Decision
- **Authentication: stateless JWT bearer tokens**, verified with [`jose`](https://github.com/panva/jose)
  (`src/shared/auth/jwt.ts`). The API never stores sessions or passwords.
  - **Production:** `AUTH_JWKS_URL` (RS256). The identity provider (e.g. Entra ID) signs with its
    private key and publishes public keys at a JWKS endpoint; the API can only *verify*, never mint,
    tokens. Key rotation is handled by the JWKS fetcher.
  - **Local / tests:** `AUTH_JWT_SECRET` (HS256, min 32 chars) plus `npm run token` to mint dev tokens.
    The CLI refuses to run with `NODE_ENV=production`.
  - Verification pins `algorithms`, `issuer`, `audience` and requires `exp` and `sub` — this blocks
    `alg: none` and RS256→HS256 confusion attacks and tokens issued for other APIs.
  - Roles come from the `roles` claim, the same claim Entra ID uses for *app roles*, so moving to
    Entra ID is configuration, not code. Unknown roles are dropped, not trusted.
- **Authorization: RBAC by permission, not by role.** Roles `PUBLIC` (no token), `USER`, `ADMIN`,
  `SYSTEM` map to permissions (`catalog:read`, `ingestion:run`, `ingestion:read`) in a single table
  (`src/shared/auth/rbac.ts`). Routes declare `requirePermission('ingestion:run')`; they never check
  role names.
- **Fail closed.** With no auth configured, every protected route returns `401`. A request that sends
  an invalid token gets `401` even on public routes (it never silently downgrades to anonymous).
  `401` vs `403` are distinct: "who are you?" vs "you can't do that". The client receives a generic
  message; the real reason (bad signature, expired, wrong audience) goes only to the server log.
- **Rate limiting:** [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit), per client
  IP, 100 requests/minute by default (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`), and a stricter
  5/minute on `POST /api/v1/ingestion`. Health probes are exempt. A `429` uses the uniform error body
  plus `Retry-After`. `TRUST_PROXY=true` makes the client IP come from `X-Forwarded-For` — only valid
  behind a trusted ingress (Azure Container Apps), otherwise clients could spoof their IP.
- **Hook order** (cheapest first): `onRequest` rate limit → `preValidation` authenticate →
  schema validation → `preHandler` authorize.

## Alternatives
- **API keys:** simpler, but they are long-lived shared secrets with no expiry, no standard claims
  and no path to Entra ID / Managed Identity. Rejected.
- **Sessions + login endpoint + users table:** means storing passwords (hashing, reset flows, brute
  force protection) for a project whose only privileged users are operators. Delegating identity to
  an IdP is both safer and closer to how Azure workloads authenticate.
- **Hand-rolled JWT verification with `node:crypto`:** ~40 lines, but "don't roll your own crypto"
  applies: `jose` is audited, dependency-free and supports JWKS.
- **Role checks in routes (`if role === 'ADMIN'`):** spreads the policy across files; adding a role
  would mean editing every route.
- **Rate limit store in Redis:** correct across replicas, but couples rate limiting to Redis health.
  Deferred to the deployment phase (see consequences).

## Consequences
- The in-memory rate-limit store is **per replica**: with N replicas the effective limit is N×. Fine
  for a single local instance; when scaling out on Azure, switch the plugin to its Redis store (it
  supports `skipOnError` to keep failing open if Redis is down) or enforce limits at the ingress.
- Per-IP limits treat users behind the same NAT as one client and can be bypassed by rotating IPs;
  it's a first line of defense, not abuse prevention.
- `USER` has no extra capability yet; it exists so personal features (and higher per-user limits)
  have a place to go.
- Token revocation before `exp` is not possible (stateless trade-off); keep token lifetimes short.
