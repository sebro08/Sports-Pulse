# Arquitectura

```
Data Sources -> Ingestion Worker -> Blob (raw)  +  PostgreSQL (structured)
                                                        |
                                                   REST API (Container Apps)
                                                     |            |
                                                   Redis     Application Insights
```

## Decisiones tomadas (Fase 0)
- Deporte: futbol. Fuente inicial: StatsBomb open data (verificar terminos de uso).
- Sin datos personales.
- Roles MVP: PUBLIC (lecturas), ADMIN (ingestion).
- Nube objetivo del primer despliegue: Azure.

## Pendiente
Trust boundaries, flujos de datos y componentes criticos (Fase 1). ADRs en docs/adr/.
