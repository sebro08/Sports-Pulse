-- SportsPulse: esquema inicial (Fase 2, version minima).
-- Jugadores, eventos y estadisticas llegan en migraciones posteriores.

CREATE TABLE data_sources (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,            -- ej. 'statsbomb-open-data'
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          smallint NOT NULL REFERENCES data_sources(id),
  idempotency_key    text NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','PARTIAL')),
  records_processed  integer NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
  records_rejected   integer NOT NULL DEFAULT 0 CHECK (records_rejected >= 0),
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  UNIQUE (source_id, idempotency_key)          -- base de la ingestion idempotente
);

CREATE TABLE competitions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    smallint NOT NULL REFERENCES data_sources(id),
  external_id  text NOT NULL,
  name         text NOT NULL,
  country      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE TABLE seasons (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competition_id  bigint NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  name            text NOT NULL,               -- ej. '2015/2016'
  start_date      date,
  end_date        date,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  UNIQUE (competition_id, external_id)
);
CREATE INDEX seasons_competition_idx ON seasons (competition_id);

CREATE TABLE teams (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    smallint NOT NULL REFERENCES data_sources(id),
  external_id  text NOT NULL,
  name         text NOT NULL,
  country      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE TABLE matches (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id        bigint NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  external_id      text NOT NULL,
  home_team_id     bigint NOT NULL REFERENCES teams(id),
  away_team_id     bigint NOT NULL REFERENCES teams(id),
  kickoff_at       timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'SCHEDULED'
                   CHECK (status IN ('SCHEDULED','LIVE','FINISHED','POSTPONED','CANCELLED')),
  home_score       smallint CHECK (home_score >= 0),
  away_score       smallint CHECK (away_score >= 0),
  ingestion_run_id uuid REFERENCES ingestion_runs(id),  -- trazabilidad del origen
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (home_team_id <> away_team_id),
  UNIQUE (season_id, external_id)
);
CREATE INDEX matches_season_kickoff_idx ON matches (season_id, kickoff_at);
CREATE INDEX matches_home_team_idx ON matches (home_team_id);
CREATE INDEX matches_away_team_idx ON matches (away_team_id);
