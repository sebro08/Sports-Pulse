# Security Policy

## Reporting a vulnerability
Open a private security advisory on GitHub (repository **Security** tab). Please do not disclose details in public issues.

## Supported versions
Only the `main` branch.

## Practices
- No secrets in Git: `.env` is ignored and `.env.example` contains names only.
- All inputs validated with Zod; SQL is parameterized; sort columns are whitelisted.
- Production secrets will live in Azure Key Vault, accessed through Managed Identity.
- Dependabot, CodeQL and Trivy are planned for the CI/CD phase; `npm audit` already runs in CI.
