-- @caia/pipeline-conductor — 004_conductor_projector_cursor.sql
-- Singleton row tracking the last event_id consumed by the projector.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.conductor_projector_cursor (
  id            SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_event_id TEXT         NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO caia_meta.conductor_projector_cursor (id, last_event_id)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;
