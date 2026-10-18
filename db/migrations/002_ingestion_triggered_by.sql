-- Trazabilidad: quien lanzo cada corrida de ingesta.
-- Valores: el `sub` del token (POST /api/v1/ingestion) o 'cli' (npm run ingest).
-- NULL en corridas anteriores a esta migracion.
ALTER TABLE ingestion_runs ADD COLUMN triggered_by text;
