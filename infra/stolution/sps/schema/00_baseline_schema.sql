-- SPS — Smart Parallelism Scheduler — SQLite schema
-- Companion artefact for: smart-parallelism-scheduler-2026-05-08.md

PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA temp_store   = MEMORY;
PRAGMA cache_size   = -262144;
PRAGMA foreign_keys = ON;

-- nodes — DAG vertices, one row per scheduling unit
CREATE TABLE IF NOT EXISTS nodes (
    id              TEXT PRIMARY KEY,
    parent_id       TEXT REFERENCES nodes(id),
    title           TEXT NOT NULL,
    item_code       TEXT NOT NULL,
    granularity     TEXT NOT NULL CHECK (granularity IN ('item','phase','leg','subtask')),
    status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','ready','assigned','running','done','failed','stuck','skipped')),
    target_bucket   TEXT,
    bucket_locked   INTEGER NOT NULL DEFAULT 0,
    file_scope      TEXT,
    package_scope   TEXT,
    page_scope      TEXT,
    agent_scope     TEXT,
    estimate_min    INTEGER,
    chain_json      TEXT,
    priority        INTEGER NOT NULL DEFAULT 100,
    retries         INTEGER NOT NULL DEFAULT 0,
    max_retries     INTEGER NOT NULL DEFAULT 3,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_status        ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_target        ON nodes(target_bucket);
CREATE INDEX IF NOT EXISTS idx_nodes_status_target ON nodes(status, target_bucket);

-- edges — DAG dependencies
CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    to_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    soft        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (from_id, to_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);

-- assignments — current and historical bucket-slot reservations
CREATE TABLE IF NOT EXISTS assignments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    bucket          TEXT NOT NULL,
    slot_index      INTEGER NOT NULL,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT,
    outcome         TEXT,
    spawn_session_id TEXT,
    spawn_pid       INTEGER,
    spawn_payload   TEXT
);
CREATE INDEX IF NOT EXISTS idx_assn_node             ON assignments(node_id);
CREATE INDEX IF NOT EXISTS idx_assn_bucket_open      ON assignments(bucket, finished_at);
CREATE INDEX IF NOT EXISTS idx_assn_last_seen        ON assignments(last_seen_at);

-- buckets — capacity / health per hardware bucket
CREATE TABLE IF NOT EXISTS buckets (
    bucket          TEXT PRIMARY KEY,
    cap             INTEGER NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    health          TEXT NOT NULL DEFAULT 'green'
                       CHECK (health IN ('green','amber','red','quota-paused','disabled')),
    circuit_open    INTEGER NOT NULL DEFAULT 0,
    circuit_until   TEXT,
    last_failure_at TEXT,
    fail_count_10m  INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO buckets (bucket, cap) VALUES
    ('M1-cowork',         4),
    ('M3-cowork',         0),
    ('stolution-claude',  4),
    ('stolution-ci',      0),
    ('stolution-build',   2),
    ('M1#2-cowork',       0);

-- history — append-only event log
CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    event       TEXT NOT NULL,
    node_id     TEXT,
    bucket      TEXT,
    payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_ts ON history(ts);

-- compensations — Saga-pattern compensating actions
CREATE TABLE IF NOT EXISTS compensations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    failure_kind    TEXT NOT NULL,
    action_kind     TEXT NOT NULL,
    action_payload  TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','done','failed')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT
);

-- bucket_metrics — rolling counters
CREATE TABLE IF NOT EXISTS bucket_metrics (
    bucket          TEXT NOT NULL,
    minute_bucket   TEXT NOT NULL,
    spawned         INTEGER NOT NULL DEFAULT 0,
    completed       INTEGER NOT NULL DEFAULT 0,
    failed          INTEGER NOT NULL DEFAULT 0,
    avg_runtime_s   INTEGER,
    PRIMARY KEY (bucket, minute_bucket)
);

-- Seed: master sequencing items
INSERT OR IGNORE INTO nodes (id, title, item_code, granularity, status, priority) VALUES
    ('B6-W1', 'Enterprise Wave 1', 'B6.W1', 'item', 'ready', 10),
    ('B1-P2', 'Mentor Phase 2', 'B1.P2', 'item', 'pending', 20),
    ('B1-P3', 'Mentor Phase 3', 'B1.P3', 'item', 'pending', 30),
    ('B1-P4', 'Mentor Phase 4', 'B1.P4', 'item', 'pending', 40),
    ('B2-P2', 'Curator Phase 2', 'B2.P2', 'item', 'pending', 50),
    ('B5-A5', 'Librarian Agent', 'B5.A5', 'item', 'pending', 60),
    ('B4-P0', 'Apprentice Phase 0', 'B4.P0', 'item', 'pending', 70);

INSERT OR IGNORE INTO edges (from_id, to_id, reason) VALUES
    ('B6-W1', 'B1-P2', 'sequencing'),
    ('B1-P2', 'B1-P3', 'phase-order'),
    ('B1-P3', 'B1-P4', 'phase-order'),
    ('B1-P3', 'B2-P2', 'sequencing'),
    ('B2-P2', 'B5-A5', 'sequencing'),
    ('B5-A5', 'B4-P0', 'sequencing');

-- Views
DROP VIEW IF EXISTS ready_nodes;
CREATE VIEW ready_nodes AS
SELECT n.*
FROM   nodes n
WHERE  n.status = 'ready'
   AND NOT EXISTS (
        SELECT 1 FROM edges e
        JOIN nodes p ON p.id = e.from_id
        WHERE  e.to_id = n.id
          AND  p.status NOT IN ('done','skipped')
        );

DROP VIEW IF EXISTS bucket_load;
CREATE VIEW bucket_load AS
SELECT b.bucket, b.cap, b.enabled, b.health,
       (SELECT COUNT(*) FROM assignments a
        WHERE a.bucket = b.bucket AND a.finished_at IS NULL) AS running,
       b.cap - (SELECT COUNT(*) FROM assignments a
                WHERE a.bucket = b.bucket AND a.finished_at IS NULL) AS free
FROM   buckets b;
