# Security Policy

## Reporting a vulnerability
Open a private security advisory on GitHub (repository **Security** tab). Please do not disclose details in public issues.

## Supported versions
Only the `main` branch.

## Practices
- No secrets in Git: `.env` is ignored and `.env.example` contains names only.
- All inputs validated with Zod; SQL is parameterized; sort columns are whitelisted.
- Admin endpoints require a JWT (algorithm, issuer, audience and expiry pinned) and a permission granted
  by RBAC; with no auth configured they reject every request. See ADR-004.
- Per-IP rate limiting on the whole API, stricter on the ingestion trigger.
- `Authorization` and `Cookie` headers are redacted from logs; token rejection reasons are logged, never
  returned to the client.
- `npm run token` (dev tokens) refuses to run with `NODE_ENV=production`.
- Production secrets will live in Azure Key Vault, accessed through Managed Identity.
- Dependabot, CodeQL and Trivy are planned for the CI/CD phase; `npm audit` already runs in CI.
