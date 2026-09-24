# Gestion de datos

## Fuente: StatsBomb Open Data
- Origen: https://github.com/statsbomb/open-data (JSON publicos).
- **Atribucion obligatoria:** si publicas o compartes analisis basados en estos datos, cita a StatsBomb como fuente y usa su logo (Media Pack). Incluirlo en el README y en cualquier demo.
- Uso: proyecto personal de portfolio / investigacion. Revisar su User Agreement antes de publicar.

## Clasificacion
| Dato | Clasificacion |
|---|---|
| Competiciones, temporadas, equipos, partidos | PUBLIC |
| ingestion_runs (metadata interna) | INTERNAL |

No se almacenan datos personales. Solo se ingiere lo necesario para el MVP (sin eventos ni alineaciones todavia).

## Ingestion
- Flujo: catalogo -> partidos -> validacion por registro (Zod) -> transaccion unica -> upsert.
- **Idempotente:** `UNIQUE(source_id, idempotency_key)` en `ingestion_runs` + `ON CONFLICT DO UPDATE` en cada tabla. Repetir una corrida no duplica filas. Una corrida COMPLETED con la misma clave se omite; FAILED/PARTIAL se reintentan.
- Clave por defecto: `statsbomb:c{competicion}:s{temporada}:{fecha}`.
- Estados: RUNNING -> COMPLETED | PARTIAL (hubo registros rechazados) | FAILED.
- Resiliencia HTTP: timeout, reintentos con backoff exponencial + jitter en timeout/429/5xx; sin reintento en 4xx.
- Anti-SSRF: las URLs se construyen a partir de una base fija y ids enteros validados.

## Limitaciones conocidas
- `kickoff_at`: StatsBomb entrega hora local del estadio sin zona horaria; se guarda como UTC (aproximacion).
- Los registros rechazados se registran en el log y se cuentan en `records_rejected`, pero aun no hay tabla de rechazados.
- Los datos crudos aun no se guardan en Blob Storage (pendiente para la fase Azure).
