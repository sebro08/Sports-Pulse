# SportsPulse

Plataforma cloud-native de analisis deportivo: API REST (TypeScript/Fastify), PostgreSQL, Redis,
despliegue en Azure Container Apps con Terraform y GitHub Actions.

> Estado: Fases 1-3 (scaffold). Ver docs/architecture.md.

## Desarrollo local

```bash
cp .env.example .env        # completa DATABASE_NAME / USER / PASSWORD y DATABASE_HOST=localhost
docker compose up -d        # PostgreSQL + Redis
npm install                 # genera package-lock.json (commitealo)
npm run migrate             # aplica migrations/*.sql
npm run dev                 # http://localhost:3000/health/ready
npm test
```

## Estructura
`src/` codigo · `migrations/` SQL versionado · `tests/` · `docs/` · `infrastructure/terraform/` (Fase 10) · `.github/workflows/`
