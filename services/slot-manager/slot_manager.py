"""
Slot Manager — Phase 4
======================
Phase 4 makes slot-manager self-driving. The autonomous loop polls SPS for
ready work, self-claims slots up to per-bucket capacity, dispatches the
spec to the registered host, and releases the slot when the spawn returns
— all without operator triggers. The full backlog drains without anyone
tapping `curl`.

Phase 4 deltas vs Phase 2
-------------------------
1.  Autonomous spawn loop. New background task `autonomous_loop_task` runs
    every LOOP_INTERVAL_SEC. Per tick, for each bucket whose autonomy
    state is 'on' AND has free slots AND has spawn-budget tokens AND has
    an active host: pull a spec from SPS, claim a slot internally,
    dispatch via the refactored /spawn-task code path, post completion
    to SPS, release the slot internally. asyncio.gather per bucket so a
    slow Mac spawn (real-work prompts can be 5+ min) does not starve
    other buckets. Default per-bucket state: OFF (operator opts in).
    Default global state: ON.

2.  /admin/spawn-completion callback. Idempotent on `spawn_id`. Closes
    the loop on spawner-side restarts.

3.  Spawn lineage. New `spawn_lineage` table + GET /spawn-lineage/{spawn_id}.

4.  Spawn retry budget + dead-letter. Autonomous loop auto-retries
    transient outcomes with exponential backoff. On exhaustion, writes
    `spawn_dead_letter` rows. Replay endpoint surfaces them.

5.  Subscription cap awareness. Per-host throttle counter. 3+ cap events
    in 5 min → host marked `cap-throttled` for the reset window.

6.  Loop instrumentation + circuit breaker.

7.  /admin/autonomy admin surface, audited via `loop_changes`.

Stop conditions
---------------
* Subscription guard tripped on any layer → ABORT loop globally, record
  `circuit-broken`. The zero-dollar rule (feedback_no_api_key_billing.md)
  is non-negotiable.
* Loop claim rate > LOOP_CIRCUIT_BREAK_PER_SEC sustained for
  LOOP_CIRCUIT_BREAK_WINDOW_SEC → global loop circuit-broken.
* All hosts simultaneously cap-throttled → loop pauses, surfaces.
* SPS returns malformed task spec → outcome=`parse_error`, surface.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

LOG_LEVEL              = os.environ.get("LOG_LEVEL", "INFO").upper()
SQLITE_PATH            = os.environ.get("SQLITE_PATH", "/data/slot-manager.db")
SCHEMA_PATH            = os.environ.get("SCHEMA_PATH", "/app/src/schema.sql")
CONFIG_PATH            = os.environ.get("CONFIG_PATH", "/app/config/slot-config.yaml")

HEARTBEAT_TIMEOUT_SEC  = int(os.environ.get("HEARTBEAT_TIMEOUT_SEC", "900"))
WATCHDOG_INTERVAL_SEC  = int(os.environ.get("WATCHDOG_INTERVAL_SEC", "60"))
LEASE_TTL_SEC          = int(os.environ.get("LEASE_TTL_SEC", "3600"))
HOST_OFFLINE_AFTER_SEC = int(os.environ.get("HOST_OFFLINE_AFTER_SEC", "300"))

SPS_BASE_URL           = os.environ.get(
    "SPS_BASE_URL", "http://sps.caia-orchestrator.svc.cluster.local:8080")
SPS_TIMEOUT_SEC        = float(os.environ.get("SPS_TIMEOUT_SEC", "5"))
SPS_ENABLED            = os.environ.get("SPS_ENABLED", "1") not in ("0", "false", "False", "")

SPAWN_TIMEOUT_SEC      = float(os.environ.get("SPAWN_TIMEOUT_SEC", "1200"))  # Phase 6 fix: 20-min default to allow real-edit dispatches to commit + push before SIGTERM
DEFAULT_SPAWN_MAX_PER_MIN = int(os.environ.get("DEFAULT_SPAWN_MAX_PER_MIN", "4"))

# Phase 4: autonomous loop knobs.
LOOP_INTERVAL_SEC               = float(os.environ.get("LOOP_INTERVAL_SEC", "10"))
LOOP_GLOBAL_DEFAULT             = os.environ.get("LOOP_GLOBAL_DEFAULT", "on")
LOOP_PER_BUCKET_DEFAULT         = os.environ.get("LOOP_PER_BUCKET_DEFAULT", "off")
LOOP_CIRCUIT_BREAK_PER_SEC      = float(os.environ.get("LOOP_CIRCUIT_BREAK_PER_SEC", "1.0"))
LOOP_CIRCUIT_BREAK_WINDOW_SEC   = int(os.environ.get("LOOP_CIRCUIT_BREAK_WINDOW_SEC", "60"))
LOOP_QUIET_LOG_INTERVAL_SEC     = int(os.environ.get("LOOP_QUIET_LOG_INTERVAL_SEC", "60"))
LOOP_RECENT_TICKS_FOR_RATE      = int(os.environ.get("LOOP_RECENT_TICKS_FOR_RATE", "12"))
LOOP_AUDIT_TRIM_AFTER           = int(os.environ.get("LOOP_AUDIT_TRIM_AFTER", "5000"))
LOOP_FANOUT_CAP_PER_BUCKET      = int(os.environ.get("LOOP_FANOUT_CAP_PER_BUCKET", "16"))

# Phase 4: subscription cap throttle.
CAP_EVENT_THRESHOLD  = int(os.environ.get("CAP_EVENT_THRESHOLD", "3"))
CAP_EVENT_WINDOW_SEC = int(os.environ.get("CAP_EVENT_WINDOW_SEC", "300"))
CAP_RESET_WINDOW_SEC = int(os.environ.get("CAP_RESET_WINDOW_SEC", "1800"))

# Phase 4: retry budget + dead-letter.
DEFAULT_RETRY_MAX        = int(os.environ.get("DEFAULT_RETRY_MAX", "3"))
DEFAULT_RETRY_BACKOFF_S  = os.environ.get("DEFAULT_RETRY_BACKOFF_S", "1,2,4")

# Histogram buckets in seconds for slot_spawn_duration_seconds.
SPAWN_DURATION_BUCKETS_S = [0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0]

# slot-manager bucket → SPS bucket aliases (Phase 2 absorbs these)
SPS_BUCKET_ALIASES: dict[str, str] = {
    "M1":        os.environ.get("SPS_ALIAS_M1",        "M1-cowork"),
    "M3":        os.environ.get("SPS_ALIAS_M3",        "M3-cowork"),
    "stolution": os.environ.get("SPS_ALIAS_STOLUTION", "stolution-claude"),
}

# Default host name per bucket. Configurable via slot-config.yaml `buckets.<b>.host`.
DEFAULT_HOST_FOR_BUCKET = {
    "M1":        "M1",
    "M3":        "M3",
    "stolution": "stolution",
}

# Phase 4: known buckets used to seed default per-bucket autonomy_state rows.
KNOWN_BUCKETS = list(DEFAULT_HOST_FOR_BUCKET.keys())

# Phase 4: regex used by the dispatch-result classifier to recognise a
# "subscription rate-limit" / cap-exceeded signal from the spawner's stderr.
CAP_THROTTLE_PATTERNS = [
    re.compile(r"(?i)rate.?limit"),
    re.compile(r"(?i)5-?hour"),
    re.compile(r"(?i)usage limit"),
    re.compile(r"(?i)quota exhausted"),
    re.compile(r"(?i)Anthropic.*rate"),
    re.compile(r"(?i)try again later"),
    re.compile(r"(?i)retry.*later"),
]

SERVICE_NAME           = os.environ.get("SERVICE_NAME", "slot-manager")
SERVICE_PORT           = int(os.environ.get("PORT", "8081"))
VERSION                = "0.5.0-phase5"

# ---------------------------------------------------------------------------
# Phase 5: real-edit mode + allow-list + risk_tier
# ---------------------------------------------------------------------------

VALID_PERMISSION_MODES = {"plan", "acceptEdits", "bypassPermissions"}
DEFAULT_PERMISSION_MODE = os.environ.get("DEFAULT_PERMISSION_MODE", "plan")

DEFAULT_BUCKET_PERMISSIONS = {
    "M1":        os.environ.get("BUCKET_PERMISSION_M1",        "acceptEdits"),
    "M3":        os.environ.get("BUCKET_PERMISSION_M3",        "acceptEdits"),
    "stolution": os.environ.get("BUCKET_PERMISSION_STOLUTION", "acceptEdits"),
}

DEFAULT_BUCKET_PATH_ALLOWLIST = [
    os.environ.get("DEFAULT_ALLOWLIST_PATH",
                   "/Users/MAC/Documents/projects"),
]

APPROVAL_TTL_SEC = int(os.environ.get("APPROVAL_TTL_SEC", "3600"))

HIGH_RISK_PATTERNS = [
    re.compile(r"(?i)--admin\b"),
    re.compile(r"(?i)\brm\s+-rf\b"),
    re.compile(r"(?i)\bforce-?push\b"),
    re.compile(r"(?i)\bsecret\s+rotation\b"),
    re.compile(r"(?i)\brotate.*secret"),
    re.compile(r"(?i)\bprod(uction)?\s+deploy"),
    re.compile(r"(?i)\bdeploy.*prod"),
    re.compile(r"(?i)\bDROP\s+(TABLE|DATABASE)"),
    re.compile(r"(?i)\bsudo\b"),
    re.compile(r"(?i)\boverride\s+safety"),
    re.compile(r"(?i)\bdisable.*guard"),
]

MEDIUM_RISK_PATTERNS = [
    re.compile(r"(?i)\.github/workflows/"),
    re.compile(r"(?i)/charts?/"),
    re.compile(r"(?i)kustomize"),
    re.compile(r"(?i)terraform"),
    re.compile(r"(?i)package\.json\b"),
    re.compile(r"(?i)pnpm-lock\.yaml"),
    re.compile(r"(?i)Dockerfile"),
    re.compile(r"(?i)\bmigration"),
]

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("slot-manager")


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Subscription guard
# ---------------------------------------------------------------------------

def _slot_manager_subscription_guard() -> str | None:
    """Return error string if ANTHROPIC_API_KEY is set in slot-manager env."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return ("ANTHROPIC_API_KEY is set in slot-manager env; "
                "refusing per zero-dollar rule (feedback_no_api_key_billing.md).")
    return None


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

_db_lock = threading.RLock()
_db: sqlite3.Connection | None = None


def db() -> sqlite3.Connection:
    global _db
    if _db is None:
        Path(SQLITE_PATH).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(
            SQLITE_PATH,
            isolation_level=None,
            check_same_thread=False,
            timeout=30.0,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA temp_store = MEMORY;")
        conn.execute("PRAGMA cache_size = -65536;")
        conn.execute("PRAGMA foreign_keys = ON;")
        _db = conn
    return _db


def apply_schema() -> None:
    schema_sql = Path(SCHEMA_PATH).read_text()
    with _db_lock:
        cur = db().cursor()
        cur.executescript(schema_sql)
    log.info("schema applied from %s", SCHEMA_PATH)
    _ensure_phase1_schema()
    _ensure_phase2_schema()
    _ensure_phase4_schema()
    _ensure_phase5_schema()


def _ensure_phase1_schema() -> None:
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        existing_cols = {r["name"] for r in cur.execute("PRAGMA table_info(slots)").fetchall()}
        if "lease_seconds" not in existing_cols:
            cur.execute(
                f"ALTER TABLE slots ADD COLUMN lease_seconds INTEGER NOT NULL DEFAULT {LEASE_TTL_SEC}"
            )
            log.info("phase1 migration: added slots.lease_seconds default=%d", LEASE_TTL_SEC)
        if "lease_started_at" not in existing_cols:
            cur.execute("ALTER TABLE slots ADD COLUMN lease_started_at TIMESTAMP")
            log.info("phase1 migration: added slots.lease_started_at")


def _ensure_phase2_schema() -> None:
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        existing_cols = {r["name"] for r in cur.execute("PRAGMA table_info(slots)").fetchall()}
        if "host" not in existing_cols:
            cur.execute("ALTER TABLE slots ADD COLUMN host TEXT NOT NULL DEFAULT ''")
            cur.execute("UPDATE slots SET host = bucket WHERE host = ''")
            log.info("phase2 migration: added slots.host (defaulted to bucket name)")


def _ensure_phase4_schema() -> None:
    """Idempotent Phase 4 migrations.

    1. Rebuild `spawn_telemetry` to relax the CHECK constraint so we can
       store the new outcome values (`parse_error`, `interrupted`,
       `cap_throttled`).
    2. Create new tables (handled by schema.sql IF NOT EXISTS, but kept
       here for hot-rollout DBs that don't have them yet).
    3. Seed default `autonomy_state` rows.
    4. Seed default `spawn_retry_budget` rows.
    """
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        # 1. Detect old narrow CHECK on spawn_telemetry.outcome and rebuild.
        try:
            sql_row = cur.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='spawn_telemetry'"
            ).fetchone()
            old_sql = (sql_row["sql"] if sql_row else "") or ""
        except Exception:
            old_sql = ""
        needs_rebuild = (
            "outcome IN" in old_sql
            and "'parse_error'" not in old_sql
        )
        if needs_rebuild:
            log.info("phase4 migration: rebuilding spawn_telemetry to widen outcome CHECK")
            cur.execute("BEGIN IMMEDIATE;")
            try:
                cur.execute("ALTER TABLE spawn_telemetry RENAME TO spawn_telemetry_old")
                cur.execute("""
                    CREATE TABLE spawn_telemetry (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      spawn_id TEXT NOT NULL UNIQUE,
                      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      completed_at TIMESTAMP,
                      duration_ms INTEGER,
                      bucket TEXT,
                      host TEXT,
                      slot_id TEXT,
                      task_id TEXT,
                      spawner_url TEXT,
                      exit_code INTEGER,
                      outcome TEXT NOT NULL DEFAULT 'pending',
                      api_key_guard_passed INTEGER NOT NULL DEFAULT 0,
                      binary_sha256 TEXT,
                      binary_path TEXT,
                      session_id TEXT,
                      model TEXT,
                      error TEXT,
                      CHECK (outcome IN (
                        'pending','ok','dispatch_error','spawner_error',
                        'rejected_guard','rejected_budget','rejected_no_host',
                        'rejected_drained','timeout','parse_error','interrupted',
                        'cap_throttled'))
                    )
                """)
                cur.execute("""
                    INSERT INTO spawn_telemetry
                    (id, spawn_id, started_at, completed_at, duration_ms,
                     bucket, host, slot_id, task_id, spawner_url, exit_code,
                     outcome, api_key_guard_passed, binary_sha256, binary_path,
                     session_id, model, error)
                    SELECT id, spawn_id, started_at, completed_at, duration_ms,
                           bucket, host, slot_id, task_id, spawner_url, exit_code,
                           outcome, api_key_guard_passed, binary_sha256, binary_path,
                           session_id, model, error
                      FROM spawn_telemetry_old
                """)
                cur.execute("DROP TABLE spawn_telemetry_old")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_started ON spawn_telemetry(started_at)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_bucket  ON spawn_telemetry(bucket)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_host    ON spawn_telemetry(host)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_outcome ON spawn_telemetry(outcome)")
                cur.execute("COMMIT;")
                log.info("phase4 migration: spawn_telemetry rebuilt")
            except Exception:
                cur.execute("ROLLBACK;")
                raise

        # 2. New tables (schema.sql also creates these; the IF NOT EXISTS
        # below is a belt-and-braces for hot rollouts).
        cur.executescript("""
            CREATE TABLE IF NOT EXISTS spawn_lineage (
              child_spawn_id  TEXT PRIMARY KEY,
              parent_spawn_id TEXT,
              parent_task_id  TEXT,
              child_task_id   TEXT,
              relation        TEXT NOT NULL,
              created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              payload         TEXT,
              CHECK (relation IN ('decomposed-into','retry-of','replay-of','continuation','autonomous-claim'))
            );
            CREATE TABLE IF NOT EXISTS spawn_retry_budget (
              bucket       TEXT NOT NULL,
              host         TEXT NOT NULL,
              max_retries  INTEGER NOT NULL DEFAULT 3,
              backoff_s_csv TEXT NOT NULL DEFAULT '1,2,4',
              updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (bucket, host)
            );
            CREATE TABLE IF NOT EXISTS spawn_dead_letter (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              original_spawn_id TEXT NOT NULL,
              bucket    TEXT,
              host      TEXT,
              task_id   TEXT,
              attempts  INTEGER NOT NULL DEFAULT 1,
              last_outcome TEXT NOT NULL,
              last_error TEXT,
              payload   TEXT,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              replayed_at TIMESTAMP,
              replay_spawn_id TEXT
            );
            CREATE TABLE IF NOT EXISTS autonomy_state (
              scope        TEXT PRIMARY KEY,
              state        TEXT NOT NULL,
              reason       TEXT,
              last_tick_at TIMESTAMP,
              last_claim_at TIMESTAMP,
              last_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              actor        TEXT,
              CHECK (state IN ('on','off','circuit-broken','cap-throttled'))
            );
            CREATE TABLE IF NOT EXISTS loop_changes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              scope     TEXT NOT NULL,
              old_state TEXT,
              new_state TEXT NOT NULL,
              actor     TEXT NOT NULL DEFAULT 'unknown',
              reason    TEXT,
              changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS host_throttle_state (
              host          TEXT PRIMARY KEY,
              cap_event_count INTEGER NOT NULL DEFAULT 0,
              first_event_at TIMESTAMP,
              last_event_at  TIMESTAMP,
              throttled_until TIMESTAMP,
              updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS loop_tick (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              iterations INTEGER NOT NULL DEFAULT 1,
              claims INTEGER NOT NULL DEFAULT 0,
              skips_no_work INTEGER NOT NULL DEFAULT 0,
              skips_no_slot INTEGER NOT NULL DEFAULT 0,
              skips_budget INTEGER NOT NULL DEFAULT 0,
              skips_throttled INTEGER NOT NULL DEFAULT 0,
              duration_ms INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_lineage_parent ON spawn_lineage(parent_spawn_id);
            CREATE INDEX IF NOT EXISTS idx_lineage_relation ON spawn_lineage(relation);
            CREATE INDEX IF NOT EXISTS idx_dead_letter_bucket ON spawn_dead_letter(bucket);
            CREATE INDEX IF NOT EXISTS idx_dead_letter_host ON spawn_dead_letter(host);
            CREATE INDEX IF NOT EXISTS idx_loop_tick_ts ON loop_tick(ts);
            CREATE INDEX IF NOT EXISTS idx_loop_changes_at ON loop_changes(changed_at);
        """)

        # 3. Seed default autonomy_state rows (idempotent).
        cur.execute("INSERT OR IGNORE INTO autonomy_state (scope, state, reason, actor) VALUES (?, ?, ?, ?)",
                    ("global", LOOP_GLOBAL_DEFAULT, "default-on-startup", "phase4-init"))
        for b in KNOWN_BUCKETS:
            cur.execute("INSERT OR IGNORE INTO autonomy_state (scope, state, reason, actor) VALUES (?, ?, ?, ?)",
                        (f"bucket:{b}", LOOP_PER_BUCKET_DEFAULT,
                         "default-off-startup-operator-must-opt-in", "phase4-init"))

        # 4. Seed default retry budgets for known (bucket, host) pairs.
        for b, h in DEFAULT_HOST_FOR_BUCKET.items():
            cur.execute(
                "INSERT OR IGNORE INTO spawn_retry_budget (bucket, host, max_retries, backoff_s_csv) "
                "VALUES (?, ?, ?, ?)",
                (b, h, DEFAULT_RETRY_MAX, DEFAULT_RETRY_BACKOFF_S),
            )
        log.info("phase4 schema/migration: tables ready, defaults seeded")




def _ensure_phase5_schema() -> None:
    """Idempotent Phase 5 migrations.

    1. New tables: bucket_permissions, bucket_path_allowlists,
       task_approvals, dispatch_risk_log.
    2. Seed default rows in bucket_permissions and
       bucket_path_allowlists for known buckets.
    """
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.executescript("""
            CREATE TABLE IF NOT EXISTS bucket_permissions (
              bucket           TEXT PRIMARY KEY,
              permission_mode  TEXT NOT NULL DEFAULT 'plan',
              updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              actor            TEXT,
              reason           TEXT,
              CHECK (permission_mode IN ('plan','acceptEdits','bypassPermissions'))
            );
            CREATE TABLE IF NOT EXISTS bucket_path_allowlists (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              bucket      TEXT NOT NULL,
              path        TEXT NOT NULL,
              active      INTEGER NOT NULL DEFAULT 1,
              created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              actor       TEXT,
              reason      TEXT,
              UNIQUE (bucket, path)
            );
            CREATE TABLE IF NOT EXISTS task_approvals (
              task_id     TEXT PRIMARY KEY,
              approved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              expires_at  TIMESTAMP NOT NULL,
              actor       TEXT NOT NULL DEFAULT 'unknown',
              reason      TEXT,
              used_at     TIMESTAMP,
              used_spawn_id TEXT
            );
            CREATE TABLE IF NOT EXISTS dispatch_risk_log (
              id              INTEGER PRIMARY KEY AUTOINCREMENT,
              spawn_id        TEXT NOT NULL,
              task_id         TEXT,
              bucket          TEXT,
              risk_tier       TEXT NOT NULL,
              permission_mode TEXT NOT NULL,
              classifier      TEXT NOT NULL,
              approval_used   TEXT,
              allow_list_json TEXT,
              created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CHECK (risk_tier IN ('low','medium','high'))
            );
            CREATE INDEX IF NOT EXISTS idx_bucket_path_allowlists_bucket ON bucket_path_allowlists(bucket);
            CREATE INDEX IF NOT EXISTS idx_task_approvals_expires_at ON task_approvals(expires_at);
            CREATE INDEX IF NOT EXISTS idx_dispatch_risk_log_spawn ON dispatch_risk_log(spawn_id);
            CREATE INDEX IF NOT EXISTS idx_dispatch_risk_log_task ON dispatch_risk_log(task_id);
            CREATE INDEX IF NOT EXISTS idx_dispatch_risk_log_tier ON dispatch_risk_log(risk_tier);
        """)
        for b, mode in DEFAULT_BUCKET_PERMISSIONS.items():
            cur.execute(
                "INSERT OR IGNORE INTO bucket_permissions (bucket, permission_mode, actor, reason) "
                "VALUES (?, ?, ?, ?)",
                (b, mode, "phase5-init", "Phase 5 default — operator-confirmed"),
            )
        for b in KNOWN_BUCKETS:
            # Phase 6 fix: only seed defaults for buckets that have no
            # existing path allowlist row. Otherwise restarts re-add the
            # Mac default path to non-Mac buckets like stolution.
            existing = cur.execute(
                "SELECT 1 FROM bucket_path_allowlists WHERE bucket = ? LIMIT 1", (b,)
            ).fetchone()
            if existing:
                continue
            for p in DEFAULT_BUCKET_PATH_ALLOWLIST:
                cur.execute(
                    "INSERT OR IGNORE INTO bucket_path_allowlists "
                    "(bucket, path, actor, reason) VALUES (?, ?, ?, ?)",
                    (b, p, "phase5-init", "Phase 5 default"),
                )
        log.info("phase5 schema/migration: tables ready, defaults seeded")


def _bucket_permission_mode(bucket: str) -> str:
    with _db_lock:
        row = db().execute(
            "SELECT permission_mode FROM bucket_permissions WHERE bucket = ?",
            (bucket,),
        ).fetchone()
    if row and row["permission_mode"] in VALID_PERMISSION_MODES:
        return row["permission_mode"]
    return DEFAULT_PERMISSION_MODE


def _bucket_allow_list(bucket: str, *, repo_scope: str | None = None) -> list[str]:
    with _db_lock:
        rows = db().execute(
            "SELECT path FROM bucket_path_allowlists "
            "WHERE bucket = ? AND active = 1 ORDER BY id",
            (bucket,),
        ).fetchall()
    paths = [r["path"] for r in rows]
    if repo_scope:
        cand = f"/Users/MAC/Documents/projects/{repo_scope.strip('/')}"
        if cand not in paths:
            paths.append(cand)
    return paths


def _classify_risk_tier(task_spec: dict[str, Any]) -> tuple[str, str]:
    explicit = (task_spec.get("risk_tier") or "").strip().lower()
    if explicit in ("low", "medium", "high"):
        return explicit, f"explicit:{explicit}"
    haystack_parts: list[str] = []
    haystack_parts.append(str(task_spec.get("title") or ""))
    haystack_parts.append(str(task_spec.get("file_scope") or ""))
    haystack_parts.append(str(task_spec.get("repo_scope") or ""))
    pm = task_spec.get("prompt_material") or {}
    if isinstance(pm, dict):
        for k in ("description", "work_directive", "must_read_first",
                  "scope_tag", "item_code", "file_scope"):
            v = pm.get(k)
            if v is None:
                continue
            if isinstance(v, list):
                haystack_parts.append(" ".join(str(x) for x in v))
            else:
                haystack_parts.append(str(v))
    haystack = " \n ".join(haystack_parts)
    for rx in HIGH_RISK_PATTERNS:
        if rx.search(haystack):
            return "high", f"auto:high:{rx.pattern[:40]}"
    for rx in MEDIUM_RISK_PATTERNS:
        if rx.search(haystack):
            return "medium", f"auto:medium:{rx.pattern[:40]}"
    return "low", "auto:low-default"


def _check_approval(task_id: str) -> dict[str, Any]:
    with _db_lock:
        row = db().execute(
            "SELECT task_id, approved_at, expires_at, actor, reason, used_at "
            "FROM task_approvals WHERE task_id = ?",
            (task_id,),
        ).fetchone()
    if not row:
        return {"ok": False, "error": "no approval"}
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    if row["expires_at"] <= now_iso:
        return {"ok": False, "error": "approval expired",
                "expires_at": row["expires_at"]}
    if row["used_at"] is not None:
        return {"ok": False, "error": "approval already used",
                "used_at": row["used_at"]}
    return {"ok": True, "approval_id": row["task_id"],
            "approved_at": row["approved_at"],
            "expires_at": row["expires_at"]}


def _consume_approval(task_id: str, spawn_id: str) -> None:
    with _db_lock:
        db().execute(
            "UPDATE task_approvals SET used_at = CURRENT_TIMESTAMP, "
            "  used_spawn_id = ? WHERE task_id = ? AND used_at IS NULL",
            (spawn_id, task_id),
        )


def _record_dispatch_risk(*, spawn_id: str, task_id: str | None,
                          bucket: str | None, risk_tier: str,
                          permission_mode: str, classifier: str,
                          approval_used: str | None,
                          allow_list: list[str]) -> None:
    with _db_lock:
        db().execute(
            "INSERT INTO dispatch_risk_log "
            "(spawn_id, task_id, bucket, risk_tier, permission_mode, "
            " classifier, approval_used, allow_list_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (spawn_id, task_id, bucket, risk_tier, permission_mode,
             classifier, approval_used, json.dumps(allow_list)),
        )


def load_config() -> dict[str, Any]:
    if not Path(CONFIG_PATH).exists():
        log.warning("config file %s not found; using Phase-0 defaults", CONFIG_PATH)
        return {
            "buckets": {
                "M1":        {"capacity": 8},
                "M3":        {"capacity": 16},
                "stolution": {"capacity": 8},
            }
        }
    return yaml.safe_load(Path(CONFIG_PATH).read_text()) or {}


def seed_slots(config: dict[str, Any]) -> None:
    buckets = (config.get("buckets") or {})
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        try:
            for bucket, cfg in buckets.items():
                capacity = int(cfg.get("capacity", 0))
                lease = int(cfg.get("lease_seconds", LEASE_TTL_SEC))
                host = cfg.get("host") or DEFAULT_HOST_FOR_BUCKET.get(bucket, bucket)
                cur.execute(
                    "SELECT COALESCE(MAX(index_in_bucket), 0) AS m FROM slots WHERE bucket = ?",
                    (bucket,),
                )
                existing_max = cur.fetchone()["m"]
                for idx in range(existing_max + 1, capacity + 1):
                    slot_id = f"{bucket}-{idx}"
                    cur.execute(
                        "INSERT OR IGNORE INTO slots (slot_id, bucket, index_in_bucket, status, lease_seconds, host) "
                        "VALUES (?, ?, ?, 'free', ?, ?)",
                        (slot_id, bucket, idx, lease, host),
                    )
                cur.execute(
                    "INSERT OR IGNORE INTO bucket_health (bucket, state) VALUES (?, 'closed')",
                    (bucket,),
                )
                cur.execute("SELECT 1 FROM spawn_budget WHERE bucket = ?", (bucket,))
                if cur.fetchone() is None:
                    max_per_min = int(cfg.get("spawn_budget_max_per_minute", DEFAULT_SPAWN_MAX_PER_MIN))
                    cur.execute(
                        "INSERT INTO spawn_budget (bucket, max_per_minute, tokens_remaining) VALUES (?, ?, ?)",
                        (bucket, max_per_min, float(max_per_min)),
                    )
                # Seed autonomy_state for any extra bucket discovered in config.
                cur.execute(
                    "INSERT OR IGNORE INTO autonomy_state (scope, state, reason, actor) VALUES (?, ?, ?, ?)",
                    (f"bucket:{bucket}", LOOP_PER_BUCKET_DEFAULT,
                     "default-off-from-config-load", "phase4-init"),
                )
                cur.execute(
                    "INSERT OR IGNORE INTO spawn_retry_budget (bucket, host, max_retries, backoff_s_csv) "
                    "VALUES (?, ?, ?, ?)",
                    (bucket, host, DEFAULT_RETRY_MAX, DEFAULT_RETRY_BACKOFF_S),
                )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    log.info("seed_slots done; buckets=%s", list(buckets))


def slot_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    out = {
        "slot_id":               row["slot_id"],
        "bucket":                row["bucket"],
        "status":                row["status"],
        "current_task_id":       row["current_task_id"],
        "current_assignment_id": row["current_assignment_id"],
        "last_updated_at":       row["last_updated_at"],
    }
    if "lease_seconds" in keys:
        out["lease_seconds"]    = row["lease_seconds"]
    if "lease_started_at" in keys:
        out["lease_started_at"] = row["lease_started_at"]
    if "host" in keys:
        out["host"]             = row["host"]
    return out


# ---------------------------------------------------------------------------
# Watchdog (Phase 1+2)
# ---------------------------------------------------------------------------

async def heartbeat_watchdog() -> None:
    log.info("watchdog: starting; interval=%ds heartbeat-timeout=%ds default-lease=%ds host-offline=%ds",
             WATCHDOG_INTERVAL_SEC, HEARTBEAT_TIMEOUT_SEC, LEASE_TTL_SEC, HOST_OFFLINE_AFTER_SEC)
    while True:
        try:
            await asyncio.sleep(WATCHDOG_INTERVAL_SEC)
            hb_released = _watchdog_sweep_heartbeat()
            lease_released = _watchdog_sweep_lease()
            host_offlined = _watchdog_sweep_hosts()
            cap_cleared = _watchdog_clear_expired_throttles()
            if hb_released:
                log.warning("watchdog: heartbeat-timeout auto-released %d slots", hb_released)
            if lease_released:
                log.warning("watchdog: lease-expired auto-released %d slots", lease_released)
            if host_offlined:
                log.warning("watchdog: marked %d hosts offline (no heartbeat)", host_offlined)
            if cap_cleared:
                log.info("watchdog: cleared %d expired host cap-throttles", cap_cleared)
        except asyncio.CancelledError:
            log.info("watchdog: cancelled")
            return
        except Exception:
            log.exception("watchdog: sweep failed (continuing)")


def _watchdog_sweep_heartbeat() -> int:
    timeout = HEARTBEAT_TIMEOUT_SEC
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        try:
            cur.execute(
                """
                SELECT a.assignment_id, a.slot_id, a.task_id, a.bucket,
                       COALESCE(a.last_heartbeat_at, a.started_at) AS last_seen
                FROM assignments a
                WHERE a.completed_at IS NULL
                  AND (
                      strftime('%s','now') -
                      strftime('%s', COALESCE(a.last_heartbeat_at, a.started_at))
                  ) > ?
                """,
                (timeout,),
            )
            stalled = cur.fetchall()
            for row in stalled:
                _force_release_locked(cur,
                    slot_id=row["slot_id"], task_id=row["task_id"],
                    assignment_id=row["assignment_id"], bucket=row["bucket"],
                    exit_status=124,
                    error_message="heartbeat timeout (watchdog)",
                    event_type="heartbeat_timeout",
                    payload={"timeout_sec": timeout, "last_seen": row["last_seen"]},
                )
            cur.execute("COMMIT;")
            return len(stalled)
        except Exception:
            cur.execute("ROLLBACK;")
            raise


def _watchdog_sweep_lease() -> int:
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        try:
            cur.execute(
                """
                SELECT a.assignment_id, a.slot_id, a.task_id, a.bucket,
                       a.started_at, s.lease_seconds
                FROM assignments a
                JOIN slots s ON s.slot_id = a.slot_id
                WHERE a.completed_at IS NULL
                  AND s.lease_seconds IS NOT NULL
                  AND (
                      strftime('%s','now') -
                      strftime('%s', a.started_at)
                  ) > s.lease_seconds
                """,
            )
            expired = cur.fetchall()
            for row in expired:
                _force_release_locked(cur,
                    slot_id=row["slot_id"], task_id=row["task_id"],
                    assignment_id=row["assignment_id"], bucket=row["bucket"],
                    exit_status=125,
                    error_message="lease expired (watchdog)",
                    event_type="lease_expired",
                    payload={"lease_seconds": row["lease_seconds"], "started_at": row["started_at"]},
                )
            cur.execute("COMMIT;")
            return len(expired)
        except Exception:
            cur.execute("ROLLBACK;")
            raise


def _watchdog_sweep_hosts() -> int:
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        try:
            cur.execute(
                """
                SELECT name FROM hosts
                 WHERE state IN ('active','drain')
                   AND (strftime('%s','now') - strftime('%s', last_heartbeat_at)) > ?
                """,
                (HOST_OFFLINE_AFTER_SEC,),
            )
            stale = [r["name"] for r in cur.fetchall()]
            for name in stale:
                cur.execute(
                    "UPDATE hosts SET state='offline', last_state_change_at=CURRENT_TIMESTAMP WHERE name = ?",
                    (name,),
                )
                cur.execute(
                    "INSERT INTO events (event_id, event_type, payload) VALUES (?, 'host_offline', ?)",
                    (str(uuid.uuid4()), json.dumps({"host": name, "reason": "no heartbeat"})),
                )
            cur.execute("COMMIT;")
            return len(stale)
        except Exception:
            cur.execute("ROLLBACK;")
            raise


def _watchdog_clear_expired_throttles() -> int:
    """Phase 4: clear host_throttle_state rows whose throttled_until has passed."""
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "SELECT host FROM host_throttle_state "
            " WHERE throttled_until IS NOT NULL "
            "   AND strftime('%s','now') >= strftime('%s', throttled_until)"
        )
        cleared = [r["host"] for r in cur.fetchall()]
        for h in cleared:
            cur.execute(
                "UPDATE host_throttle_state "
                "   SET cap_event_count = 0, first_event_at = NULL, last_event_at = NULL, "
                "       throttled_until = NULL, updated_at = CURRENT_TIMESTAMP "
                " WHERE host = ?",
                (h,),
            )
        return len(cleared)


def _force_release_locked(cur, *, slot_id, task_id, assignment_id, bucket,
                          exit_status, error_message, event_type, payload):
    cur.execute(
        "UPDATE assignments SET completed_at = CURRENT_TIMESTAMP, exit_status = ?, error_message = ? WHERE assignment_id = ?",
        (exit_status, error_message, assignment_id),
    )
    cur.execute(
        "UPDATE slots SET status = 'free', current_task_id = NULL, current_assignment_id = NULL, lease_started_at = NULL, last_updated_at = CURRENT_TIMESTAMP WHERE slot_id = ?",
        (slot_id,),
    )
    cur.execute(
        "INSERT INTO events (event_id, event_type, slot_id, task_id, assignment_id, bucket, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), event_type, slot_id, task_id, assignment_id, bucket, json.dumps(payload)),
    )


# ---------------------------------------------------------------------------
# SPS client
# ---------------------------------------------------------------------------

async def sps_request_next_spawn(bucket: str, slot_id: str) -> dict[str, Any] | None:
    if not SPS_ENABLED:
        return None
    sps_bucket = SPS_BUCKET_ALIASES.get(bucket, bucket)
    url = f"{SPS_BASE_URL.rstrip('/')}/spawn"
    payload = {"bucket": sps_bucket, "slot_id": slot_id}
    try:
        async with httpx.AsyncClient(timeout=SPS_TIMEOUT_SEC) as client:
            resp = await client.post(url, json=payload)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError) as e:
        log.warning("sps unreachable for bucket=%s alias=%s: %s — returning null next_task_spec",
                    bucket, sps_bucket, e)
        return None
    except Exception:
        log.exception("sps call failed; returning null next_task_spec")
        return None
    if resp.status_code == 204:
        return None
    if resp.status_code != 200:
        log.warning("sps /spawn returned %d for bucket=%s alias=%s body=%s",
                    resp.status_code, bucket, sps_bucket, resp.text[:200])
        return None
    try:
        body = resp.json()
    except Exception:
        log.warning("sps /spawn returned non-JSON 200; body=%s", resp.text[:200])
        return None
    if not isinstance(body, dict):
        return {"raw": body}
    return body


async def sps_post_completion(*, node_id: str, bucket_alias: str, outcome: str,
                               outcome_detail: str | None = None) -> bool:
    """POST {SPS}/completion — best-effort, non-fatal on failure."""
    if not SPS_ENABLED:
        return False
    url = f"{SPS_BASE_URL.rstrip('/')}/completion"
    body = {"node_id": node_id, "bucket": bucket_alias,
            "outcome": outcome, "outcome_detail": outcome_detail}
    try:
        async with httpx.AsyncClient(timeout=SPS_TIMEOUT_SEC) as client:
            resp = await client.post(url, json=body)
    except Exception as e:
        log.warning("sps completion POST failed node=%s outcome=%s: %s",
                    node_id, outcome, e)
        return False
    if resp.status_code != 200:
        log.warning("sps completion non-200 node=%s outcome=%s status=%d body=%s",
                    node_id, outcome, resp.status_code, resp.text[:200])
        return False
    return True


# ---------------------------------------------------------------------------
# Spawn budget (Phase 2)
# ---------------------------------------------------------------------------

def _budget_refill_locked(cur, bucket: str) -> dict[str, Any] | None:
    cur.execute(
        "SELECT bucket, max_per_minute, tokens_remaining, last_refill_at, "
        "       strftime('%s','now') AS now_s, "
        "       strftime('%s', last_refill_at) AS last_s "
        "  FROM spawn_budget WHERE bucket = ?",
        (bucket,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    elapsed_s = max(0.0, float(row["now_s"]) - float(row["last_s"]))
    rate_per_s = row["max_per_minute"] / 60.0
    refill = elapsed_s * rate_per_s
    new_tokens = min(float(row["max_per_minute"]), float(row["tokens_remaining"]) + refill)
    cur.execute(
        "UPDATE spawn_budget SET tokens_remaining = ?, last_refill_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP "
        " WHERE bucket = ?",
        (new_tokens, bucket),
    )
    return {
        "bucket":           row["bucket"],
        "max_per_minute":   row["max_per_minute"],
        "tokens_remaining": new_tokens,
        "last_refill_at":   utcnow_iso(),
    }


def _budget_take_locked(cur, bucket: str) -> tuple[bool, dict[str, Any] | None]:
    state = _budget_refill_locked(cur, bucket)
    if state is None:
        cur.execute(
            "INSERT INTO spawn_budget (bucket, max_per_minute, tokens_remaining) VALUES (?, ?, ?)",
            (bucket, DEFAULT_SPAWN_MAX_PER_MIN, float(DEFAULT_SPAWN_MAX_PER_MIN)),
        )
        state = _budget_refill_locked(cur, bucket)
        if state is None:
            return False, None
    if state["tokens_remaining"] < 1.0:
        return False, state
    new_tokens = state["tokens_remaining"] - 1.0
    cur.execute(
        "UPDATE spawn_budget SET tokens_remaining = ?, updated_at = CURRENT_TIMESTAMP WHERE bucket = ?",
        (new_tokens, bucket),
    )
    state["tokens_remaining"] = new_tokens
    return True, state


def _budget_peek_locked(cur, bucket: str) -> dict[str, Any] | None:
    """Phase 4: refill-only peek used by the loop's pre-claim guard."""
    return _budget_refill_locked(cur, bucket)


# ---------------------------------------------------------------------------
# Spawn dispatch + telemetry (Phase 2)
# ---------------------------------------------------------------------------

async def _dispatch_to_spawner(
    *,
    spawner_url: str,
    payload: dict[str, Any],
    timeout_s: float,
) -> tuple[int, dict[str, Any] | str]:
    url = f"{spawner_url.rstrip('/')}/spawn"
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(url, json=payload)
    except httpx.TimeoutException as e:
        return 599, f"timeout: {e}"
    except (httpx.ConnectError, httpx.RemoteProtocolError) as e:
        return 598, f"connect_error: {e}"
    except Exception as e:
        return 597, f"unexpected: {e}"
    try:
        body = resp.json()
    except Exception:
        body = resp.text
    return resp.status_code, body


def _record_spawn(
    *,
    spawn_id: str,
    bucket: str | None = None,
    host: str | None = None,
    slot_id: str | None = None,
    task_id: str | None = None,
    spawner_url: str | None = None,
    outcome: str = "pending",
    api_key_guard_passed: bool = False,
    started_at_iso: str | None = None,
) -> None:
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "INSERT INTO spawn_telemetry (spawn_id, started_at, bucket, host, slot_id, task_id, "
            "                             spawner_url, outcome, api_key_guard_passed) "
            "VALUES (?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?)",
            (spawn_id, started_at_iso, bucket, host, slot_id, task_id, spawner_url,
             outcome, 1 if api_key_guard_passed else 0),
        )


def _complete_spawn(
    *,
    spawn_id: str,
    duration_ms: int,
    outcome: str,
    exit_code: int | None = None,
    binary_sha256: str | None = None,
    binary_path: str | None = None,
    session_id: str | None = None,
    model: str | None = None,
    error: str | None = None,
) -> None:
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "UPDATE spawn_telemetry "
            "   SET completed_at = CURRENT_TIMESTAMP, duration_ms = ?, outcome = ?, "
            "       exit_code = ?, binary_sha256 = ?, binary_path = ?, "
            "       session_id = ?, model = ?, error = ? "
            " WHERE spawn_id = ?",
            (duration_ms, outcome, exit_code, binary_sha256, binary_path,
             session_id, model, error, spawn_id),
        )


def _get_spawn_telemetry(spawn_id: str) -> dict[str, Any] | None:
    with _db_lock:
        row = db().execute(
            "SELECT * FROM spawn_telemetry WHERE spawn_id = ?", (spawn_id,)
        ).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Phase 4 helpers: lineage, retry, throttle, autonomy
# ---------------------------------------------------------------------------

def _record_lineage(
    *,
    child_spawn_id: str,
    parent_spawn_id: str | None,
    relation: str,
    parent_task_id: str | None = None,
    child_task_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Insert a spawn_lineage row (idempotent on child_spawn_id)."""
    if not parent_spawn_id and relation == "autonomous-claim":
        # Lineage of an autonomous root claim — record without parent_spawn_id.
        pass
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "INSERT OR IGNORE INTO spawn_lineage "
            "(child_spawn_id, parent_spawn_id, parent_task_id, child_task_id, relation, payload) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (child_spawn_id, parent_spawn_id, parent_task_id, child_task_id,
             relation, json.dumps(payload or {})),
        )


def _spawn_lineage_walk(spawn_id: str) -> dict[str, Any]:
    """Recursive ancestor walk + immediate children for a given spawn_id."""
    ancestors: list[dict[str, Any]] = []
    seen: set[str] = set()
    cur_id: str | None = spawn_id
    with _db_lock:
        cur = db().cursor()
        # Ancestors (parent chain).
        while cur_id and cur_id not in seen:
            seen.add(cur_id)
            row = cur.execute(
                "SELECT child_spawn_id, parent_spawn_id, relation, parent_task_id, child_task_id, payload, created_at "
                "  FROM spawn_lineage WHERE child_spawn_id = ?",
                (cur_id,),
            ).fetchone()
            if row is None:
                break
            ancestors.append({
                "child_spawn_id":  row["child_spawn_id"],
                "parent_spawn_id": row["parent_spawn_id"],
                "relation":        row["relation"],
                "parent_task_id":  row["parent_task_id"],
                "child_task_id":   row["child_task_id"],
                "created_at":      row["created_at"],
            })
            cur_id = row["parent_spawn_id"]
            if cur_id is None:
                break
        # Immediate children.
        kids = cur.execute(
            "SELECT child_spawn_id, parent_spawn_id, relation, parent_task_id, child_task_id, payload, created_at "
            "  FROM spawn_lineage WHERE parent_spawn_id = ? ORDER BY created_at",
            (spawn_id,),
        ).fetchall()
    return {
        "spawn_id": spawn_id,
        "ancestors": ancestors[1:] if ancestors and ancestors[0]["child_spawn_id"] == spawn_id else ancestors,
        "children": [dict(r) for r in kids],
    }


def _resolve_retry_budget(bucket: str, host: str) -> tuple[int, list[float]]:
    """Return (max_retries, backoff_s_list). Falls back to defaults."""
    with _db_lock:
        row = db().execute(
            "SELECT max_retries, backoff_s_csv FROM spawn_retry_budget "
            " WHERE bucket = ? AND host = ?",
            (bucket, host),
        ).fetchone()
    if row is None:
        max_retries = DEFAULT_RETRY_MAX
        csv_s = DEFAULT_RETRY_BACKOFF_S
    else:
        max_retries = int(row["max_retries"])
        csv_s = row["backoff_s_csv"]
    backoff_list: list[float] = []
    for tok in (csv_s or "").split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            backoff_list.append(float(tok))
        except ValueError:
            continue
    if not backoff_list:
        backoff_list = [1.0, 2.0, 4.0]
    return max_retries, backoff_list


def _retryable_outcome(outcome: str) -> bool:
    """Phase 4: which terminal outcomes are eligible for an autonomous retry?

    Non-retryable:
    - rejected_guard: subscription guard tripped — HALT, do not retry.
    - rejected_budget: token bucket will refill — wait.
    - rejected_no_host / rejected_drained: host state must change — wait.
    - cap_throttled: handled separately (host-level throttle).
    - parse_error: surfaces; operator must triage.
    """
    return outcome in ("spawner_error", "dispatch_error", "timeout", "interrupted")


def _is_cap_throttle_signal(error_text: str | None) -> bool:
    if not error_text:
        return False
    for p in CAP_THROTTLE_PATTERNS:
        if p.search(error_text):
            return True
    return False


def _record_cap_event(host: str) -> dict[str, Any]:
    """Record a cap-exceeded event for `host` and possibly mark it throttled."""
    with _db_lock:
        cur = db().cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            row = cur.execute(
                "SELECT cap_event_count, first_event_at, throttled_until FROM host_throttle_state WHERE host = ?",
                (host,),
            ).fetchone()
            if row is None:
                cur.execute(
                    "INSERT INTO host_throttle_state (host, cap_event_count, first_event_at, last_event_at) "
                    "VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    (host,),
                )
                event_count = 1
                first_at = utcnow_iso()
            else:
                # Decay window: if first_event_at older than CAP_EVENT_WINDOW_SEC, reset.
                first_at = row["first_event_at"]
                cur.execute(
                    "SELECT strftime('%s','now') AS now_s, "
                    "       COALESCE(strftime('%s', ?), 0) AS first_s",
                    (first_at,),
                )
                ts_row = cur.fetchone()
                age_s = float(ts_row["now_s"]) - float(ts_row["first_s"])
                if age_s > CAP_EVENT_WINDOW_SEC:
                    cur.execute(
                        "UPDATE host_throttle_state "
                        "   SET cap_event_count = 1, first_event_at = CURRENT_TIMESTAMP, "
                        "       last_event_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP "
                        " WHERE host = ?",
                        (host,),
                    )
                    event_count = 1
                else:
                    event_count = int(row["cap_event_count"]) + 1
                    cur.execute(
                        "UPDATE host_throttle_state "
                        "   SET cap_event_count = ?, last_event_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP "
                        " WHERE host = ?",
                        (event_count, host),
                    )

            throttled = False
            if event_count >= CAP_EVENT_THRESHOLD:
                cur.execute(
                    "UPDATE host_throttle_state "
                    "   SET throttled_until = datetime('now', ? || ' seconds'), updated_at = CURRENT_TIMESTAMP "
                    " WHERE host = ?",
                    (f"+{CAP_RESET_WINDOW_SEC}", host),
                )
                # Audit + autonomy state surfacing.
                cur.execute(
                    "INSERT INTO loop_changes (scope, old_state, new_state, actor, reason) VALUES (?, ?, ?, ?, ?)",
                    (f"host:{host}", None, "cap-throttled", "cap-watcher",
                     f"{event_count} cap events in <{CAP_EVENT_WINDOW_SEC}s"),
                )
                throttled = True
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    return {"host": host, "event_count": event_count, "throttled": throttled}


def _is_host_cap_throttled(host: str) -> bool:
    with _db_lock:
        row = db().execute(
            "SELECT throttled_until, "
            "       (strftime('%s', throttled_until) - strftime('%s','now')) AS sec_left "
            "  FROM host_throttle_state WHERE host = ?",
            (host,),
        ).fetchone()
    if row is None or row["throttled_until"] is None:
        return False
    return float(row["sec_left"] or 0) > 0


def _read_autonomy(scope: str) -> dict[str, Any] | None:
    with _db_lock:
        row = db().execute(
            "SELECT scope, state, reason, last_tick_at, last_claim_at, last_changed_at, actor "
            "  FROM autonomy_state WHERE scope = ?",
            (scope,),
        ).fetchone()
    return dict(row) if row else None


def _set_autonomy(scope: str, new_state: str, *, actor: str = "operator",
                   reason: str | None = None) -> dict[str, Any]:
    if new_state not in ("on", "off", "circuit-broken", "cap-throttled"):
        raise ValueError(f"invalid autonomy state {new_state!r}")
    with _db_lock:
        cur = db().cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            existing = cur.execute(
                "SELECT state FROM autonomy_state WHERE scope = ?", (scope,),
            ).fetchone()
            old_state = existing["state"] if existing else None
            if existing is None:
                cur.execute(
                    "INSERT INTO autonomy_state (scope, state, reason, actor, last_changed_at) "
                    "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                    (scope, new_state, reason, actor),
                )
            else:
                cur.execute(
                    "UPDATE autonomy_state "
                    "   SET state = ?, reason = ?, actor = ?, last_changed_at = CURRENT_TIMESTAMP "
                    " WHERE scope = ?",
                    (new_state, reason, actor, scope),
                )
            cur.execute(
                "INSERT INTO loop_changes (scope, old_state, new_state, actor, reason) VALUES (?, ?, ?, ?, ?)",
                (scope, old_state, new_state, actor, reason),
            )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    log.info("autonomy: %s -> %s actor=%s reason=%s", scope, new_state, actor, reason)
    return {"scope": scope, "old_state": old_state, "new_state": new_state,
            "actor": actor, "reason": reason}


def _list_autonomy() -> dict[str, Any]:
    with _db_lock:
        rows = db().execute(
            "SELECT scope, state, reason, last_tick_at, last_claim_at, last_changed_at, actor "
            "  FROM autonomy_state ORDER BY scope"
        ).fetchall()
    states = [dict(r) for r in rows]
    by_scope = {r["scope"]: r["state"] for r in states}
    return {
        "global": by_scope.get("global", LOOP_GLOBAL_DEFAULT),
        "buckets": {s["scope"][len("bucket:"):]: dict(s)
                    for s in states if s["scope"].startswith("bucket:")},
        "all": states,
    }


# ---------------------------------------------------------------------------
# Phase 4 internal helpers: claim/release/spawn-task without HTTP roundtrips
# ---------------------------------------------------------------------------

def _claim_internal(bucket: str, *, task_id: str, node_id: str = "autonomous-loop",
                     event_type: str = "task_spawned") -> dict[str, Any] | None:
    """Atomically claim a free slot in `bucket`. Returns slot dict or None."""
    assignment_id = str(uuid.uuid4())
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            cur.execute(
                "SELECT slot_id, host FROM slots WHERE bucket = ? AND status = 'free' "
                "ORDER BY index_in_bucket LIMIT 1",
                (bucket,),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute("ROLLBACK;")
                return None
            slot_id = row["slot_id"]
            host    = row["host"] if "host" in row.keys() else None
            cur.execute(
                "UPDATE slots SET status = 'occupied', current_task_id = ?, current_assignment_id = ?, "
                "                lease_started_at = CURRENT_TIMESTAMP, last_updated_at = CURRENT_TIMESTAMP "
                " WHERE slot_id = ? AND status = 'free'",
                (task_id, assignment_id, slot_id),
            )
            if cur.rowcount != 1:
                cur.execute("ROLLBACK;")
                return None
            cur.execute(
                "INSERT INTO assignments (assignment_id, slot_id, task_id, node_id, bucket, started_at, last_heartbeat_at) "
                "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                (assignment_id, slot_id, task_id, node_id, bucket),
            )
            cur.execute(
                "INSERT INTO events (event_id, event_type, slot_id, task_id, assignment_id, bucket) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), event_type, slot_id, task_id, assignment_id, bucket),
            )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    return {"slot_id": slot_id, "host": host, "assignment_id": assignment_id,
            "task_id": task_id, "bucket": bucket}


def _release_internal(slot_id: str, task_id: str, *, exit_status: int = 0,
                       artifacts: list[str] | None = None,
                       error_message: str | None = None) -> dict[str, Any] | None:
    """Internal release used by the autonomous loop. Doesn't fetch a new spec."""
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            row = cur.execute(
                "SELECT slot_id, status, current_task_id, current_assignment_id, bucket FROM slots WHERE slot_id = ?",
                (slot_id,),
            ).fetchone()
            if row is None:
                cur.execute("ROLLBACK;")
                return None
            assignment_id = row["current_assignment_id"]
            bucket = row["bucket"]
            current_task = row["current_task_id"]
            if row["status"] != "occupied":
                cur.execute("ROLLBACK;")
                return None
            if current_task != task_id:
                cur.execute("ROLLBACK;")
                return None
            cur.execute(
                "UPDATE assignments SET completed_at = CURRENT_TIMESTAMP, exit_status = ?, error_message = ? WHERE assignment_id = ?",
                (exit_status, error_message, assignment_id),
            )
            cur.execute(
                "UPDATE slots SET status = 'free', current_task_id = NULL, current_assignment_id = NULL, lease_started_at = NULL, last_updated_at = CURRENT_TIMESTAMP WHERE slot_id = ?",
                (slot_id,),
            )
            cur.execute(
                "INSERT INTO events (event_id, event_type, slot_id, task_id, assignment_id, bucket, payload) VALUES (?, 'slot_released', ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), slot_id, task_id, assignment_id, bucket,
                 json.dumps({"exit_status": exit_status, "artifacts": artifacts or [],
                             "actor": "autonomous-loop"})),
            )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    return {"slot_id": slot_id, "task_id": task_id, "bucket": bucket,
            "exit_status": exit_status}


async def _spawn_task_internal(
    *,
    slot_id: str,
    task_id: str,
    task_spec: dict[str, Any],
    force: bool = False,
    parent_spawn_id: str | None = None,
    lineage_relation: str = "autonomous-claim",
) -> dict[str, Any]:
    """The Phase 2 spawn_task body without HTTPException wrappers.

    Returns a dict with shape:
       {ok, status_code, spawn_id, outcome, exit_code, duration_ms,
        binary_sha256, binary_path, session_id, model, error,
        spawner_response, host, bucket, spawner_url}
    HTTPException-style errors are returned as ok=false with status_code
    and outcome populated.
    """
    spawn_id = str(uuid.uuid4())
    started_iso = utcnow_iso()
    t_start = time.time()

    # Lineage row goes in regardless of outcome (so retries link cleanly).
    _record_lineage(child_spawn_id=spawn_id, parent_spawn_id=parent_spawn_id,
                    relation=lineage_relation,
                    parent_task_id=None, child_task_id=task_id,
                    payload={"slot_id": slot_id, "spec_id": task_spec.get("id")})

    # 1. Subscription guard
    guard = _slot_manager_subscription_guard()
    if guard:
        _record_spawn(spawn_id=spawn_id, slot_id=slot_id, task_id=task_id,
                      outcome="rejected_guard", api_key_guard_passed=False,
                      started_at_iso=started_iso)
        _complete_spawn(spawn_id=spawn_id,
                        duration_ms=int((time.time() - t_start) * 1000),
                        outcome="rejected_guard", error=guard)
        return {"ok": False, "status_code": 451, "spawn_id": spawn_id,
                "outcome": "rejected_guard", "error": guard,
                "duration_ms": int((time.time() - t_start) * 1000)}

    # 2. Look up slot
    with _db_lock:
        row = db().execute(
            "SELECT s.slot_id, s.bucket, s.host, s.status, s.current_task_id, "
            "       s.current_assignment_id "
            "  FROM slots s WHERE s.slot_id = ?",
            (slot_id,),
        ).fetchone()
    if row is None:
        return {"ok": False, "status_code": 404, "spawn_id": spawn_id,
                "outcome": "parse_error",
                "error": f"unknown slot {slot_id!r}",
                "duration_ms": int((time.time() - t_start) * 1000)}
    if row["status"] != "occupied":
        return {"ok": False, "status_code": 409, "spawn_id": spawn_id,
                "outcome": "parse_error",
                "error": f"slot {slot_id} not occupied (status={row['status']})",
                "duration_ms": int((time.time() - t_start) * 1000)}

    bucket = row["bucket"]
    host_name = row["host"] or DEFAULT_HOST_FOR_BUCKET.get(bucket, bucket)
    assignment_id = row["current_assignment_id"]
    effective_task_id = task_id or row["current_task_id"]

    # 3. Host registry
    with _db_lock:
        host_row = db().execute(
            "SELECT name, spawner_url, state FROM hosts WHERE name = ?",
            (host_name,),
        ).fetchone()
    if host_row is None:
        _record_spawn(spawn_id=spawn_id, slot_id=slot_id, bucket=bucket,
                      host=host_name, task_id=effective_task_id,
                      outcome="rejected_no_host", api_key_guard_passed=True,
                      started_at_iso=started_iso)
        _complete_spawn(spawn_id=spawn_id,
                        duration_ms=int((time.time() - t_start) * 1000),
                        outcome="rejected_no_host",
                        error=f"host {host_name!r} not registered")
        return {"ok": False, "status_code": 503, "spawn_id": spawn_id,
                "outcome": "rejected_no_host", "host": host_name,
                "error": f"host {host_name!r} not registered",
                "duration_ms": int((time.time() - t_start) * 1000)}
    if host_row["state"] not in ("active",):
        _record_spawn(spawn_id=spawn_id, slot_id=slot_id, bucket=bucket,
                      host=host_name, task_id=effective_task_id,
                      spawner_url=host_row["spawner_url"],
                      outcome="rejected_drained", api_key_guard_passed=True,
                      started_at_iso=started_iso)
        _complete_spawn(spawn_id=spawn_id,
                        duration_ms=int((time.time() - t_start) * 1000),
                        outcome="rejected_drained",
                        error=f"host {host_name!r} state={host_row['state']!r}")
        return {"ok": False, "status_code": 503, "spawn_id": spawn_id,
                "outcome": "rejected_drained", "host": host_name,
                "error": f"host state={host_row['state']!r}",
                "duration_ms": int((time.time() - t_start) * 1000)}

    # 4. Budget
    if not force:
        with _db_lock:
            cur = db().cursor()
            cur.execute("BEGIN IMMEDIATE;")
            try:
                ok, state = _budget_take_locked(cur, bucket)
                cur.execute("COMMIT;")
            except Exception:
                cur.execute("ROLLBACK;")
                raise
        if not ok:
            _record_spawn(spawn_id=spawn_id, slot_id=slot_id, bucket=bucket,
                          host=host_name, task_id=effective_task_id,
                          spawner_url=host_row["spawner_url"],
                          outcome="rejected_budget", api_key_guard_passed=True,
                          started_at_iso=started_iso)
            _complete_spawn(spawn_id=spawn_id,
                            duration_ms=int((time.time() - t_start) * 1000),
                            outcome="rejected_budget",
                            error=f"bucket {bucket!r} budget exhausted")
            return {"ok": False, "status_code": 429, "spawn_id": spawn_id,
                    "outcome": "rejected_budget", "host": host_name,
                    "tokens_remaining": (state or {}).get("tokens_remaining"),
                    "duration_ms": int((time.time() - t_start) * 1000)}

    _record_spawn(spawn_id=spawn_id, slot_id=slot_id, bucket=bucket,
                  host=host_name, task_id=effective_task_id,
                  spawner_url=host_row["spawner_url"],
                  outcome="pending", api_key_guard_passed=True,
                  started_at_iso=started_iso)

    # ---------------------------------------------------------------
    # Phase 5: resolve permission_mode + allow_list + risk_tier and
    # gate high-risk dispatches on a fresh operator approval.
    # ---------------------------------------------------------------
    permission_mode = (task_spec.get("permission_mode")
                       or _bucket_permission_mode(bucket))
    if permission_mode not in VALID_PERMISSION_MODES:
        permission_mode = DEFAULT_PERMISSION_MODE

    repo_scope = task_spec.get("repo_scope")
    allow_list = _bucket_allow_list(bucket, repo_scope=repo_scope)

    risk_tier, classifier = _classify_risk_tier(task_spec)

    approval_used: str | None = None
    if risk_tier == "high":
        appr = _check_approval(effective_task_id)
        if not appr.get("ok"):
            err = (f"high-risk task {effective_task_id!r} requires fresh "
                   f"operator approval ({appr.get('error')}); "
                   f"POST /admin/approve/{effective_task_id} to grant "
                   f"(1h TTL). classifier={classifier}")
            _complete_spawn(spawn_id=spawn_id,
                            duration_ms=int((time.time() - t_start) * 1000),
                            outcome="rejected_guard", error=err)
            _record_dispatch_risk(spawn_id=spawn_id,
                                  task_id=effective_task_id,
                                  bucket=bucket, risk_tier=risk_tier,
                                  permission_mode=permission_mode,
                                  classifier=classifier,
                                  approval_used=None,
                                  allow_list=allow_list)
            log.warning("phase5: rejected_guard high-risk no-approval task=%s classifier=%s",
                        effective_task_id, classifier)
            return {"ok": False, "status_code": 451, "spawn_id": spawn_id,
                    "outcome": "approval_required", "host": host_name,
                    "bucket": bucket, "task_id": effective_task_id,
                    "risk_tier": risk_tier, "classifier": classifier,
                    "error": err,
                    "duration_ms": int((time.time() - t_start) * 1000)}
        approval_used = appr.get("approval_id")

    _record_dispatch_risk(spawn_id=spawn_id,
                          task_id=effective_task_id,
                          bucket=bucket, risk_tier=risk_tier,
                          permission_mode=permission_mode,
                          classifier=classifier,
                          approval_used=approval_used,
                          allow_list=allow_list)

    auto_pr = bool(task_spec.get("auto_pr",
                                 permission_mode in ("acceptEdits", "bypassPermissions")))
    auto_merge_default = (risk_tier == "low"
                          and permission_mode in ("acceptEdits", "bypassPermissions"))
    auto_merge = bool(task_spec.get("auto_merge", auto_merge_default))
    if risk_tier == "high":
        auto_merge = False

    cwd = task_spec.get("cwd")
    # Phase 6 fix: cwd default is host-aware via the bucket allow-list root.
    # M1 -> /Users/MAC/Documents/projects; stolution -> /home/s903/stolution.
    _allow_root = (allow_list[0] if allow_list else "/Users/MAC/Documents/projects").rstrip("/")
    if not cwd and repo_scope:
        cwd = f"{_allow_root}/{repo_scope.strip('/')}"
    elif not cwd and permission_mode in ("acceptEdits", "bypassPermissions"):
        cwd = _allow_root

    base_url = (
        os.environ.get("SLOT_MANAGER_PUBLIC_URL")
        or f"http://{os.environ.get('POD_IP') or os.environ.get('SERVICE_NAME', 'slot-manager')}:{SERVICE_PORT}"
    )
    dispatch_payload: dict[str, Any] = {
        "spawn_id":           spawn_id,
        "slot_id":            slot_id,
        "task_id":            effective_task_id,
        "assignment_id":      assignment_id,
        "task_spec":          task_spec,
        "bucket":             bucket,
        "host":               host_name,
        "heartbeat_url":      f"{base_url.rstrip('/')}/heartbeat",
        "release_url":        f"{base_url.rstrip('/')}/release",
        "spawn_callback_url": f"{base_url.rstrip('/')}/admin/spawn-completion",
        "require_subscription": True,
        "timeout_sec":        SPAWN_TIMEOUT_SEC,
        "parent_spawn_id":    parent_spawn_id,
        "permission_mode":    permission_mode,
        "allow_list":         allow_list,
        "risk_tier":          risk_tier,
        "cwd":                cwd,
        "auto_pr":            auto_pr,
        "auto_merge":         auto_merge,
    }

    if approval_used:
        _consume_approval(effective_task_id, spawn_id)

    status_code, body_resp = await _dispatch_to_spawner(
        spawner_url=host_row["spawner_url"],
        payload=dispatch_payload,
        timeout_s=SPAWN_TIMEOUT_SEC,
    )
    duration_ms = int((time.time() - t_start) * 1000)

    if status_code == 599:
        _complete_spawn(spawn_id=spawn_id, duration_ms=duration_ms,
                        outcome="timeout", error=str(body_resp))
        return {"ok": False, "status_code": 504, "spawn_id": spawn_id,
                "outcome": "timeout", "host": host_name, "bucket": bucket,
                "error": str(body_resp), "duration_ms": duration_ms}
    if status_code in (598, 597):
        _complete_spawn(spawn_id=spawn_id, duration_ms=duration_ms,
                        outcome="dispatch_error", error=str(body_resp))
        return {"ok": False, "status_code": 502, "spawn_id": spawn_id,
                "outcome": "dispatch_error", "host": host_name, "bucket": bucket,
                "error": str(body_resp), "duration_ms": duration_ms}
    if status_code != 200:
        err_str = (body_resp if isinstance(body_resp, str)
                   else json.dumps(body_resp)[:1000])
        exc = (body_resp.get("exit_code") if isinstance(body_resp, dict) else None)
        _complete_spawn(spawn_id=spawn_id, duration_ms=duration_ms,
                        outcome="spawner_error", exit_code=exc, error=err_str)
        return {"ok": False, "status_code": 502, "spawn_id": spawn_id,
                "outcome": "spawner_error", "host": host_name, "bucket": bucket,
                "exit_code": exc, "error": err_str, "duration_ms": duration_ms}

    if not isinstance(body_resp, dict):
        _complete_spawn(spawn_id=spawn_id, duration_ms=duration_ms,
                        outcome="spawner_error",
                        error=f"non-JSON 200 body: {str(body_resp)[:200]}")
        return {"ok": False, "status_code": 502, "spawn_id": spawn_id,
                "outcome": "spawner_error", "host": host_name, "bucket": bucket,
                "error": "non-JSON 200", "duration_ms": duration_ms}

    if not body_resp.get("subscription_only", False):
        _complete_spawn(spawn_id=spawn_id, duration_ms=duration_ms,
                        outcome="rejected_guard",
                        error="spawner did not confirm subscription_only=true",
                        binary_sha256=body_resp.get("binary_sha256"),
                        binary_path=body_resp.get("binary_path"))
        return {"ok": False, "status_code": 451, "spawn_id": spawn_id,
                "outcome": "rejected_guard", "host": host_name, "bucket": bucket,
                "error": "spawner did not confirm subscription-only",
                "duration_ms": duration_ms}

    spawner_outcome = body_resp.get("outcome") or ("ok" if body_resp.get("ok") else "spawner_error")
    exit_code = body_resp.get("exit_code")
    if exit_code is None and "rc" in body_resp:
        exit_code = body_resp.get("rc")
    binary_sha256 = body_resp.get("binary_sha256")
    binary_path   = body_resp.get("binary_path")
    session_id    = (body_resp.get("session_id")
                     or (body_resp.get("parsed") or {}).get("session_id"))
    model         = (body_resp.get("model")
                     or (body_resp.get("parsed") or {}).get("model"))

    final_outcome = "ok" if (spawner_outcome == "ok" and (exit_code in (None, 0))) else "spawner_error"

    # Phase 4: classify cap-throttle signal in the spawner's error blob.
    err_blob = body_resp.get("error") or body_resp.get("stderr") or ""
    if final_outcome != "ok" and _is_cap_throttle_signal(err_blob):
        final_outcome = "cap_throttled"

    err_field = None
    if final_outcome != "ok":
        err_field = f"spawner outcome={spawner_outcome} exit_code={exit_code} err={str(err_blob)[:240]}"

    _complete_spawn(spawn_id=spawn_id, duration_ms=duration_ms,
                    outcome=final_outcome, exit_code=exit_code,
                    binary_sha256=binary_sha256, binary_path=binary_path,
                    session_id=session_id, model=model, error=err_field)

    log.info(
        "spawn-task ok=%s spawn_id=%s slot=%s host=%s bucket=%s outcome=%s exit=%s dur_ms=%d session=%s",
        final_outcome == "ok", spawn_id, slot_id, host_name, bucket,
        final_outcome, exit_code, duration_ms, session_id,
    )

    return {
        "ok":                  final_outcome == "ok",
        "status_code":         200,
        "spawn_id":            spawn_id,
        "slot_id":             slot_id,
        "task_id":             effective_task_id,
        "bucket":              bucket,
        "host":                host_name,
        "spawner_url":         host_row["spawner_url"],
        "outcome":             final_outcome,
        "exit_code":           exit_code,
        "duration_ms":         duration_ms,
        "binary_sha256":       binary_sha256,
        "binary_path":         binary_path,
        "session_id":          session_id,
        "model":               model,
        "subscription_only":   True,
        "started_at":          started_iso,
        "completed_at":        utcnow_iso(),
        "spawner_response":    body_resp,
    }


# ---------------------------------------------------------------------------
# Phase 4 autonomous loop
# ---------------------------------------------------------------------------

# Process-local rolling window of recent claim timestamps (for the circuit
# breaker). Each entry is a UNIX float seconds.
_recent_claim_ts: list[float] = []
_recent_claim_lock = threading.Lock()


def _record_recent_claim() -> None:
    now = time.time()
    with _recent_claim_lock:
        _recent_claim_ts.append(now)
        # Trim entries older than the window.
        cutoff = now - LOOP_CIRCUIT_BREAK_WINDOW_SEC
        while _recent_claim_ts and _recent_claim_ts[0] < cutoff:
            _recent_claim_ts.pop(0)


def _claim_rate_per_sec() -> float:
    now = time.time()
    cutoff = now - LOOP_CIRCUIT_BREAK_WINDOW_SEC
    with _recent_claim_lock:
        # Trim
        while _recent_claim_ts and _recent_claim_ts[0] < cutoff:
            _recent_claim_ts.pop(0)
        n = len(_recent_claim_ts)
    return n / max(1.0, float(LOOP_CIRCUIT_BREAK_WINDOW_SEC))


def _list_eligible_buckets() -> list[dict[str, Any]]:
    """Return buckets with autonomy=on, in order. Each entry has:
       {bucket, free_slots, host, host_state, sps_alias, tokens, max_per_minute}.
    """
    out: list[dict[str, Any]] = []
    with _db_lock:
        cur = db().cursor()
        states = {r["scope"]: r["state"]
                  for r in cur.execute("SELECT scope, state FROM autonomy_state").fetchall()}
        gstate = states.get("global", LOOP_GLOBAL_DEFAULT)
        if gstate != "on":
            return []
        slot_rows = cur.execute(
            "SELECT bucket, host, COUNT(*) AS free_n FROM slots WHERE status = 'free' GROUP BY bucket, host"
        ).fetchall()
        host_rows = {r["name"]: r["state"]
                     for r in cur.execute("SELECT name, state FROM hosts").fetchall()}
        # Phase 6 fix: refill spawn-budget tokens for each bucket with free
        # slots BEFORE reading them, so eligibility reflects time-elapsed
        # refill instead of a stale snapshot. Without this, the budget skip
        # reason became a permanent stall when tokens dipped below 1.0
        # (per slot_manager_budget_throttle_unblock_2026-05-10.md).
        budget_rows: dict[str, dict[str, Any]] = {}
        seen_buckets: set[str] = set()
        for _r in slot_rows:
            _b = _r["bucket"]
            if _b in seen_buckets:
                continue
            seen_buckets.add(_b)
            _state = _budget_peek_locked(cur, _b)
            if _state is not None:
                budget_rows[_b] = {
                    "bucket":           _state["bucket"],
                    "max_per_minute":   _state["max_per_minute"],
                    "tokens_remaining": _state["tokens_remaining"],
                }

    for r in slot_rows:
        bucket = r["bucket"]
        scope = f"bucket:{bucket}"
        bstate = states.get(scope, LOOP_PER_BUCKET_DEFAULT)
        if bstate != "on":
            continue
        host = r["host"] or DEFAULT_HOST_FOR_BUCKET.get(bucket, bucket)
        host_state = host_rows.get(host, "unregistered")
        budget = budget_rows.get(bucket, {})
        out.append({
            "bucket": bucket,
            "host": host,
            "host_state": host_state,
            "free_slots": int(r["free_n"]),
            "sps_alias": SPS_BUCKET_ALIASES.get(bucket, bucket),
            "tokens_remaining": float(budget.get("tokens_remaining", 0.0)),
            "max_per_minute": int(budget.get("max_per_minute", DEFAULT_SPAWN_MAX_PER_MIN)),
        })
    out.sort(key=lambda e: (e["bucket"], e["host"]))
    return out


def _record_loop_tick(*, claims: int, skips: dict[str, int], duration_ms: int) -> None:
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "INSERT INTO loop_tick (claims, skips_no_work, skips_no_slot, "
            "                       skips_budget, skips_throttled, duration_ms) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (claims, skips.get("no_work", 0), skips.get("no_slot", 0),
             skips.get("budget", 0), skips.get("throttled", 0), duration_ms),
        )
        # Trim retention.
        cur.execute(
            "DELETE FROM loop_tick WHERE id IN ("
            "  SELECT id FROM loop_tick ORDER BY id DESC LIMIT -1 OFFSET ?)",
            (LOOP_AUDIT_TRIM_AFTER,),
        )


def _circuit_break_if_runaway() -> bool:
    """If recent claim rate > LOOP_CIRCUIT_BREAK_PER_SEC sustained for the
    full window, flip global autonomy to circuit-broken.

    Returns True if the breaker fired.
    """
    rate = _claim_rate_per_sec()
    if rate > LOOP_CIRCUIT_BREAK_PER_SEC:
        glob = _read_autonomy("global")
        if glob and glob["state"] == "on":
            _set_autonomy("global", "circuit-broken", actor="circuit-breaker",
                          reason=f"claim-rate {rate:.3f}/s > {LOOP_CIRCUIT_BREAK_PER_SEC}/s "
                                 f"sustained for {LOOP_CIRCUIT_BREAK_WINDOW_SEC}s")
            log.error("CIRCUIT BREAKER: claim rate %.3f/s exceeded threshold; loop paused", rate)
            return True
    return False


def _check_all_hosts_throttled() -> bool:
    """If every registered active host is cap-throttled, surface and pause."""
    with _db_lock:
        cur = db().cursor()
        host_states = cur.execute(
            "SELECT name FROM hosts WHERE state = 'active'"
        ).fetchall()
        if not host_states:
            return False
        active_names = [r["name"] for r in host_states]
        throttled = []
        for n in active_names:
            tr = cur.execute(
                "SELECT throttled_until, "
                "       (strftime('%s', throttled_until) - strftime('%s','now')) AS sec_left "
                "  FROM host_throttle_state WHERE host = ?",
                (n,),
            ).fetchone()
            if tr and tr["throttled_until"] and float(tr["sec_left"] or 0) > 0:
                throttled.append(n)
    if active_names and len(throttled) == len(active_names):
        glob = _read_autonomy("global")
        if glob and glob["state"] == "on":
            _set_autonomy("global", "cap-throttled", actor="cap-watcher",
                          reason=f"all active hosts cap-throttled: {throttled}")
            log.error("ALL HOSTS THROTTLED: %s; loop paused", throttled)
            return True
    return False


async def autonomous_loop_task() -> None:
    """Phase 4 main loop. Runs until cancelled."""
    log.info("autonomy: starting loop interval=%.1fs global_default=%s per_bucket_default=%s",
             LOOP_INTERVAL_SEC, LOOP_GLOBAL_DEFAULT, LOOP_PER_BUCKET_DEFAULT)
    quiet_since = 0.0
    while True:
        t_start = time.time()
        try:
            await asyncio.sleep(LOOP_INTERVAL_SEC)
            # Subscription guard re-check at top of every tick.
            guard = _slot_manager_subscription_guard()
            if guard:
                log.error("autonomy: subscription guard tripped mid-loop: %s", guard)
                _set_autonomy("global", "circuit-broken", actor="subscription-guard",
                              reason=guard)
                continue

            # Read global autonomy.
            glob = _read_autonomy("global")
            gstate = (glob or {}).get("state", LOOP_GLOBAL_DEFAULT)
            if gstate != "on":
                # Quiet-log once per minute.
                if time.time() - quiet_since > LOOP_QUIET_LOG_INTERVAL_SEC:
                    log.info("autonomy: global state=%s — loop quiescent", gstate)
                    quiet_since = time.time()
                continue

            # Iterate eligible buckets in parallel.
            eligible = _list_eligible_buckets()
            if not eligible:
                if time.time() - quiet_since > LOOP_QUIET_LOG_INTERVAL_SEC:
                    log.info("autonomy: no eligible buckets (autonomy off OR no free slots) — sleeping")
                    quiet_since = time.time()
                _record_loop_tick(claims=0, skips={}, duration_ms=int((time.time() - t_start) * 1000))
                continue

            results = await asyncio.gather(
                *[_loop_tick_for_bucket(b) for b in eligible],
                return_exceptions=True,
            )

            claims = 0
            skips = {"no_work": 0, "no_slot": 0, "budget": 0, "throttled": 0}
            # Phase-7: _loop_tick_for_bucket returns a LIST of per-claim dicts.
            flat: list[dict[str, Any]] = []
            for r in results:
                if isinstance(r, Exception):
                    log.exception("autonomy: per-bucket tick raised: %r", r)
                    continue
                if isinstance(r, list):
                    flat.extend(x for x in r if isinstance(x, dict))
                elif isinstance(r, dict):
                    flat.append(r)
            for r in flat:
                action = r.get("action")
                if action == "claim":
                    claims += 1
                elif action == "skip":
                    reason = r.get("reason", "unknown")
                    skips[reason] = skips.get(reason, 0) + 1

            duration_ms = int((time.time() - t_start) * 1000)
            _record_loop_tick(claims=claims, skips=skips, duration_ms=duration_ms)

            # Update global last_tick_at marker.
            with _db_lock:
                db().execute(
                    "UPDATE autonomy_state SET last_tick_at = CURRENT_TIMESTAMP WHERE scope = 'global'"
                )

            if claims:
                quiet_since = 0.0
                log.info("autonomy: tick — claims=%d skips=%s duration_ms=%d", claims, skips, duration_ms)
            else:
                if time.time() - quiet_since > LOOP_QUIET_LOG_INTERVAL_SEC:
                    log.info("autonomy: tick — no claims (skips=%s) eligible_buckets=%d duration_ms=%d",
                             skips, len(eligible), duration_ms)
                    quiet_since = time.time()

            # Check stop conditions.
            _circuit_break_if_runaway()
            _check_all_hosts_throttled()

        except asyncio.CancelledError:
            log.info("autonomy: loop cancelled")
            return
        except Exception:
            log.exception("autonomy: loop iteration raised; sleeping and continuing")


async def _loop_tick_for_bucket(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """One tick of the autonomous loop for a single bucket.

    Phase-7 fan-out: instead of one claim+dispatch per tick per bucket,
    fans out up to min(free_slots, floor(tokens_remaining),
    LOOP_FANOUT_CAP_PER_BUCKET) parallel claim+dispatch coroutines so the
    loop can ramp toward bucket cap quickly. The token-bucket budget
    (`spawn_budget`) still gates the sustained spawn rate; this only
    changes the per-tick burst-up shape.

    Returns a list of per-claim result dicts (each with action="claim" or "skip").
    """
    bucket = spec["bucket"]
    host   = spec["host"]

    # Bucket-level skip preconditions — no point fanning out.
    if spec["free_slots"] <= 0:
        return [{"action": "skip", "reason": "no_slot", "bucket": bucket}]
    if spec["host_state"] != "active":
        return [{"action": "skip", "reason": "throttled", "bucket": bucket,
                 "detail": f"host_state={spec['host_state']!r}"}]
    if _is_host_cap_throttled(host):
        return [{"action": "skip", "reason": "throttled", "bucket": bucket,
                 "detail": f"host {host} cap-throttled"}]
    if spec["tokens_remaining"] < 1.0:
        return [{"action": "skip", "reason": "budget", "bucket": bucket,
                 "tokens_remaining": spec["tokens_remaining"]}]

    fanout = min(int(spec["free_slots"]),
                 int(spec["tokens_remaining"]),
                 LOOP_FANOUT_CAP_PER_BUCKET)
    if fanout <= 0:
        return [{"action": "skip", "reason": "no_slot", "bucket": bucket}]

    inner = await asyncio.gather(
        *[_single_claim_and_dispatch_for_bucket(spec) for _ in range(fanout)],
        return_exceptions=True,
    )
    out: list[dict[str, Any]] = []
    for r in inner:
        if isinstance(r, Exception):
            log.exception("autonomy: fan-out claim raised for bucket=%s: %r", bucket, r)
            out.append({"action": "skip", "reason": "no_work", "bucket": bucket,
                        "detail": f"exception: {r!r}"})
        elif isinstance(r, dict):
            out.append(r)
    return out


async def _single_claim_and_dispatch_for_bucket(spec: dict[str, Any]) -> dict[str, Any]:
    """Phase-7 helper: a single claim+dispatch attempt for the bucket described in spec.

    Contains the original body of _loop_tick_for_bucket from the SPS pull onward.
    The fan-out wrapper enforces bucket-level preconditions before calling this,
    so we only do per-attempt races here (SPS spec pull, _claim_internal,
    _spawn_task_internal). Concurrent racers safely lose to _db_lock and
    bounce through SPS as ``cancelled``/``no_slot``.
    """
    bucket = spec["bucket"]
    host = spec["host"]
    sps_alias = spec["sps_alias"]

    # Skip if no free slots.
    if spec["free_slots"] <= 0:
        return {"action": "skip", "reason": "no_slot", "bucket": bucket}

    # Skip if host inactive or cap-throttled.
    if spec["host_state"] != "active":
        return {"action": "skip", "reason": "throttled", "bucket": bucket,
                "detail": f"host_state={spec['host_state']!r}"}
    if _is_host_cap_throttled(host):
        return {"action": "skip", "reason": "throttled", "bucket": bucket,
                "detail": f"host {host} cap-throttled"}

    # Skip if budget < 1.
    if spec["tokens_remaining"] < 1.0:
        return {"action": "skip", "reason": "budget", "bucket": bucket,
                "tokens_remaining": spec["tokens_remaining"]}

    # Pull a spec from SPS — use a synthetic slot_id that flags it as a peek
    # (slot-manager will claim its own real slot below). We pass a unique
    # placeholder so SPS records spawn-via-slot history.
    placeholder_slot = f"auto:{bucket}:{uuid.uuid4().hex[:8]}"
    sps_spec = await sps_request_next_spawn(bucket, placeholder_slot)
    if sps_spec is None:
        return {"action": "skip", "reason": "no_work", "bucket": bucket}

    # Validate spec shape (parse_error).
    spec_id = sps_spec.get("id")
    if not spec_id:
        log.warning("autonomy: SPS returned malformed spec for bucket=%s: %s",
                    bucket, json.dumps(sps_spec)[:240])
        # Best-effort completion: tell SPS the work failed to parse.
        await sps_post_completion(node_id=sps_spec.get("id") or "unknown",
                                   bucket_alias=sps_alias, outcome="failed",
                                   outcome_detail="parse_error: missing id")
        return {"action": "skip", "reason": "no_work", "bucket": bucket,
                "detail": "parse_error"}

    # Internal claim.
    claimed = _claim_internal(bucket, task_id=spec_id, node_id=spec_id,
                              event_type="autonomous_claim")
    if claimed is None:
        # Race: race lost — release the SPS-side claim by completing as cancelled.
        await sps_post_completion(node_id=spec_id, bucket_alias=sps_alias,
                                   outcome="cancelled",
                                   outcome_detail="slot-manager claim race")
        return {"action": "skip", "reason": "no_slot", "bucket": bucket}

    _record_recent_claim()

    # Dispatch.
    try:
        result = await _spawn_task_internal(
            slot_id=claimed["slot_id"],
            task_id=spec_id,
            task_spec=sps_spec,
            parent_spawn_id=None,
            lineage_relation="autonomous-claim",
        )
    except Exception as e:
        log.exception("autonomy: dispatch raised for bucket=%s id=%s", bucket, spec_id)
        result = {"ok": False, "spawn_id": None, "outcome": "dispatch_error",
                  "host": host, "bucket": bucket, "error": str(e), "duration_ms": 0}

    # Surface cap-throttle signal.
    if result.get("outcome") == "cap_throttled":
        _record_cap_event(host)

    # Map slot-manager outcome → SPS outcome.
    sm_outcome = result.get("outcome", "spawner_error")
    if sm_outcome == "ok":
        sps_outcome = "done"
    elif sm_outcome in ("rejected_guard",):
        sps_outcome = "failed"
    elif sm_outcome in ("cap_throttled", "rejected_budget", "rejected_drained", "rejected_no_host"):
        sps_outcome = "cancelled"  # bounce back to ready when SPS resolves
    else:
        sps_outcome = "failed"

    detail = f"sm_outcome={sm_outcome} spawn_id={result.get('spawn_id')} dur_ms={result.get('duration_ms')}"
    await sps_post_completion(node_id=spec_id, bucket_alias=sps_alias,
                               outcome=sps_outcome, outcome_detail=detail)

    # Release the slot.
    _release_internal(claimed["slot_id"], spec_id,
                       exit_status=int(result.get("exit_code") or 0),
                       error_message=result.get("error"))

    # Phase 4 retry path (transient outcomes).
    retry_attempt_no = None
    if _retryable_outcome(sm_outcome):
        max_retries, backoff = _resolve_retry_budget(bucket, host)
        # Walk lineage to count prior retry-of attempts in this chain.
        attempt = 1
        cur_id = result.get("spawn_id")
        with _db_lock:
            cur = db().cursor()
            while cur_id:
                row = cur.execute(
                    "SELECT parent_spawn_id, relation FROM spawn_lineage WHERE child_spawn_id = ?",
                    (cur_id,),
                ).fetchone()
                if row is None or row["relation"] != "retry-of":
                    break
                attempt += 1
                cur_id = row["parent_spawn_id"]
        retry_attempt_no = attempt
        if attempt < max_retries:
            backoff_idx = min(attempt - 1, len(backoff) - 1)
            delay = backoff[backoff_idx]
            log.info("autonomy: scheduling retry attempt=%d/%d for spec_id=%s after %.1fs",
                     attempt + 1, max_retries, spec_id, delay)
            asyncio.create_task(_schedule_retry(
                bucket=bucket, host=host, sps_alias=sps_alias,
                spec=sps_spec, parent_spawn_id=result.get("spawn_id"),
                delay_s=delay, attempt=attempt + 1, max_retries=max_retries,
            ))
        else:
            # Exhausted — write to dead-letter.
            log.warning("autonomy: retries exhausted for spec_id=%s after %d attempts; dead-letter",
                        spec_id, attempt)
            with _db_lock:
                db().execute(
                    "INSERT INTO spawn_dead_letter "
                    "(original_spawn_id, bucket, host, task_id, attempts, last_outcome, last_error, payload) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (result.get("spawn_id"), bucket, host, spec_id, attempt, sm_outcome,
                     result.get("error"), json.dumps(sps_spec)[:8000]),
                )

    # Update last_claim_at on the autonomy_state row.
    with _db_lock:
        db().execute(
            "UPDATE autonomy_state SET last_claim_at = CURRENT_TIMESTAMP WHERE scope = ?",
            (f"bucket:{bucket}",),
        )

    return {"action": "claim", "bucket": bucket, "outcome": sm_outcome,
            "spawn_id": result.get("spawn_id"), "task_id": spec_id,
            "retry_attempt": retry_attempt_no}


async def _schedule_retry(*, bucket: str, host: str, sps_alias: str,
                           spec: dict[str, Any], parent_spawn_id: str | None,
                           delay_s: float, attempt: int, max_retries: int) -> None:
    """Phase 4: scheduled retry. Fires after delay_s, claims a slot,
    dispatches with lineage='retry-of'.
    """
    try:
        await asyncio.sleep(delay_s)
    except asyncio.CancelledError:
        return
    spec_id = spec.get("id")
    if not spec_id:
        return
    # Re-acquire a slot.
    claimed = _claim_internal(bucket, task_id=spec_id, node_id=spec_id,
                              event_type="autonomous_retry")
    if claimed is None:
        log.info("autonomy: retry — no free slot for bucket=%s spec_id=%s; will be re-handled by next tick",
                 bucket, spec_id)
        return
    _record_recent_claim()
    try:
        result = await _spawn_task_internal(
            slot_id=claimed["slot_id"],
            task_id=spec_id,
            task_spec=spec,
            parent_spawn_id=parent_spawn_id,
            lineage_relation="retry-of",
        )
    except Exception as e:
        result = {"ok": False, "outcome": "dispatch_error",
                  "spawn_id": None, "error": str(e), "duration_ms": 0}

    sm_outcome = result.get("outcome", "spawner_error")
    sps_outcome = "done" if sm_outcome == "ok" else (
        "failed" if sm_outcome in ("rejected_guard",)
        else "cancelled" if sm_outcome in ("cap_throttled","rejected_budget","rejected_drained","rejected_no_host")
        else "failed")
    await sps_post_completion(node_id=spec_id, bucket_alias=sps_alias,
                               outcome=sps_outcome,
                               outcome_detail=f"retry attempt={attempt}/{max_retries} sm_outcome={sm_outcome}")
    _release_internal(claimed["slot_id"], spec_id,
                       exit_status=int(result.get("exit_code") or 0),
                       error_message=result.get("error"))

    # Recursive retry / dead-letter.
    if _retryable_outcome(sm_outcome) and attempt < max_retries:
        _, backoff = _resolve_retry_budget(bucket, host)
        idx = min(attempt - 1, len(backoff) - 1)
        asyncio.create_task(_schedule_retry(
            bucket=bucket, host=host, sps_alias=sps_alias, spec=spec,
            parent_spawn_id=result.get("spawn_id"),
            delay_s=backoff[idx], attempt=attempt + 1, max_retries=max_retries,
        ))
    elif _retryable_outcome(sm_outcome):
        with _db_lock:
            db().execute(
                "INSERT INTO spawn_dead_letter "
                "(original_spawn_id, bucket, host, task_id, attempts, last_outcome, last_error, payload) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (result.get("spawn_id"), bucket, host, spec_id, attempt, sm_outcome,
                 result.get("error"), json.dumps(spec)[:8000]),
            )


# ---------------------------------------------------------------------------
# FastAPI lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("slot-manager %s starting; sqlite=%s sps=%s sps_enabled=%s",
             VERSION, SQLITE_PATH, SPS_BASE_URL, SPS_ENABLED)
    guard = _slot_manager_subscription_guard()
    if guard:
        log.error("STARTUP REFUSED: %s", guard)
        raise SystemExit(2)
    log.info("subscription-guard OK at startup (ANTHROPIC_API_KEY unset)")
    apply_schema()
    seed_slots(load_config())

    watchdog_task = asyncio.create_task(heartbeat_watchdog())
    auto_task     = asyncio.create_task(autonomous_loop_task())
    log.info("slot-manager ready on port %d (watchdog + autonomous loop running)", SERVICE_PORT)
    try:
        yield
    finally:
        for t in (auto_task, watchdog_task):
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
        if _db is not None:
            _db.close()


app = FastAPI(
    title="Slot Manager",
    description="Phase 4 — autonomous loop polls SPS, self-claims slots, dispatches "
                "to host spawners, releases. Subscription-only at every layer.",
    version=VERSION,
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------

@app.get("/health", response_class=PlainTextResponse)
@app.get("/healthz", response_class=PlainTextResponse)
def health() -> str:
    with _db_lock:
        db().execute("SELECT 1").fetchone()
    return "OK"


@app.get("/version")
def version() -> dict[str, Any]:
    return {
        "service":             SERVICE_NAME,
        "version":             VERSION,
        "phase":               5,
        "sps_base_url":        SPS_BASE_URL,
        "sps_enabled":         SPS_ENABLED,
        "sps_bucket_aliases":  SPS_BUCKET_ALIASES,
        "default_host_for_bucket": DEFAULT_HOST_FOR_BUCKET,
        "lease_ttl_sec":       LEASE_TTL_SEC,
        "heartbeat_timeout":   HEARTBEAT_TIMEOUT_SEC,
        "watchdog_interval":   WATCHDOG_INTERVAL_SEC,
        "host_offline_after":  HOST_OFFLINE_AFTER_SEC,
        "spawn_timeout_sec":   SPAWN_TIMEOUT_SEC,
        "default_spawn_max_per_minute": DEFAULT_SPAWN_MAX_PER_MIN,
        "subscription_guard_at_startup": True,
        "loop_interval_sec":   LOOP_INTERVAL_SEC,
        "loop_global_default": LOOP_GLOBAL_DEFAULT,
        "loop_per_bucket_default": LOOP_PER_BUCKET_DEFAULT,
        "loop_circuit_break_per_sec": LOOP_CIRCUIT_BREAK_PER_SEC,
        "loop_circuit_break_window_sec": LOOP_CIRCUIT_BREAK_WINDOW_SEC,
        "cap_event_threshold": CAP_EVENT_THRESHOLD,
        "cap_event_window_sec": CAP_EVENT_WINDOW_SEC,
        "cap_reset_window_sec": CAP_RESET_WINDOW_SEC,
        "default_retry_max":   DEFAULT_RETRY_MAX,
        "default_retry_backoff_s": DEFAULT_RETRY_BACKOFF_S,
        "valid_permission_modes":  sorted(VALID_PERMISSION_MODES),
        "default_permission_mode": DEFAULT_PERMISSION_MODE,
        "default_bucket_permissions": DEFAULT_BUCKET_PERMISSIONS,
        "default_bucket_path_allowlist": DEFAULT_BUCKET_PATH_ALLOWLIST,
        "approval_ttl_sec":  APPROVAL_TTL_SEC,
        "high_risk_pattern_count":   len(HIGH_RISK_PATTERNS),
        "medium_risk_pattern_count": len(MEDIUM_RISK_PATTERNS),
    }


@app.get("/slots")
def list_slots() -> dict[str, Any]:
    with _db_lock:
        rows = db().execute("SELECT * FROM slots ORDER BY bucket, index_in_bucket").fetchall()
    slots = [slot_to_dict(r) for r in rows]
    by_bucket: dict[str, dict[str, int]] = {}
    by_host:   dict[str, dict[str, int]] = {}
    for s in slots:
        b = by_bucket.setdefault(s["bucket"], {"total": 0, "free": 0, "occupied": 0,
                                               "claimed": 0, "draining": 0, "disabled": 0})
        b["total"] += 1
        b[s["status"]] = b.get(s["status"], 0) + 1
        h = by_host.setdefault(s.get("host") or "<unset>", {"total": 0, "free": 0, "occupied": 0,
                                                            "claimed": 0, "draining": 0, "disabled": 0})
        h["total"] += 1
        h[s["status"]] = h.get(s["status"], 0) + 1
    return {
        "slots":          slots,
        "total_count":    len(slots),
        "free_count":     sum(1 for s in slots if s["status"] == "free"),
        "occupied_count": sum(1 for s in slots if s["status"] == "occupied"),
        "claimed_count":  sum(1 for s in slots if s["status"] == "claimed"),
        "disabled_count": sum(1 for s in slots if s["status"] == "disabled"),
        "by_bucket":      by_bucket,
        "by_host":        by_host,
    }


@app.get("/slots/{machine}")
def slots_by_machine(machine: str) -> dict[str, Any]:
    with _db_lock:
        rows = db().execute(
            "SELECT * FROM slots WHERE bucket = ? ORDER BY index_in_bucket",
            (machine,),
        ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail=f"unknown bucket {machine!r}")
    return {"machine": machine, "slots": [slot_to_dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# Claim
# ---------------------------------------------------------------------------

@app.post("/claim")
async def claim_slot(request: Request) -> JSONResponse:
    body = await _json_body(request)
    bucket  = body.get("bucket")
    task_id = body.get("task_id")
    node_id = body.get("node_id") or "phase1-smoke"
    if not bucket:
        raise HTTPException(status_code=400, detail="missing 'bucket'")
    assignment_id = str(uuid.uuid4())
    task_id = task_id or f"phase1-{assignment_id[:8]}"
    claimed = _claim_internal(bucket, task_id=task_id, node_id=node_id)
    if claimed is None:
        with _db_lock:
            row = db().execute("SELECT 1 FROM slots WHERE bucket = ? LIMIT 1", (bucket,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"unknown bucket {bucket!r}")
        return JSONResponse(status_code=503, content={"detail": "no free slots in bucket; retry"})
    log.info("claim: bucket=%s host=%s slot=%s task=%s assignment=%s",
             bucket, claimed.get("host"), claimed["slot_id"],
             claimed["task_id"], claimed["assignment_id"])
    return JSONResponse(status_code=200, content={
        "slot_id":       claimed["slot_id"],
        "bucket":        bucket,
        "host":          claimed.get("host"),
        "assignment_id": claimed["assignment_id"],
        "task_id":       claimed["task_id"],
        "claimed_at":    utcnow_iso(),
    })


# ---------------------------------------------------------------------------
# Release (with SPS spec fetch — Phase 1 contract)
# ---------------------------------------------------------------------------

async def _do_release(slot_id: str, task_id: str, exit_status: int = 0,
                      artifacts: list[str] | None = None,
                      error_message: str | None = None) -> dict[str, Any]:
    bucket: str | None = None
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            cur.execute(
                "SELECT slot_id, status, current_task_id, current_assignment_id, bucket FROM slots WHERE slot_id = ?",
                (slot_id,),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail=f"unknown slot {slot_id!r}")
            assignment_id = row["current_assignment_id"]
            bucket = row["bucket"]
            current_task = row["current_task_id"]
            if row["status"] != "occupied":
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=409,
                    detail=f"slot {slot_id} not occupied (status={row['status']})")
            if current_task != task_id:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=409,
                    detail=f"task_id mismatch: slot has {current_task!r}, got {task_id!r}")
            cur.execute(
                "UPDATE assignments SET completed_at = CURRENT_TIMESTAMP, exit_status = ?, error_message = ? WHERE assignment_id = ?",
                (exit_status, error_message, assignment_id),
            )
            cur.execute(
                "UPDATE slots SET status = 'free', current_task_id = NULL, current_assignment_id = NULL, lease_started_at = NULL, last_updated_at = CURRENT_TIMESTAMP WHERE slot_id = ?",
                (slot_id,),
            )
            cur.execute(
                "INSERT INTO events (event_id, event_type, slot_id, task_id, assignment_id, bucket, payload) VALUES (?, 'slot_released', ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), slot_id, task_id, assignment_id, bucket,
                 json.dumps({"exit_status": exit_status, "artifacts": artifacts or []})),
            )
            cur.execute("COMMIT;")
        except HTTPException:
            raise
        except Exception:
            cur.execute("ROLLBACK;")
            raise

    log.info("release: slot=%s task=%s exit=%d", slot_id, task_id, exit_status)

    next_task_spec: dict[str, Any] | None = None
    if bucket:
        t0 = time.time()
        next_task_spec = await sps_request_next_spawn(bucket, slot_id)
        latency_ms = int((time.time() - t0) * 1000)
        try:
            with _db_lock:
                db().execute(
                    "INSERT INTO spawn_log (slot_id, bucket, task_id, dispatch_status, sps_latency_ms) VALUES (?, ?, ?, ?, ?)",
                    (slot_id, bucket,
                     (next_task_spec or {}).get("item_code")
                     or (next_task_spec or {}).get("id")
                     or None,
                     "success" if next_task_spec else "error_sps",
                     latency_ms),
                )
        except Exception:
            log.exception("spawn_log insert failed (non-fatal)")

    return {
        "slot_id":         slot_id,
        "task_id":         task_id,
        "released_at":     utcnow_iso(),
        "exit_status":     exit_status,
        "next_task_spec":  next_task_spec,
    }


@app.post("/release")
async def release_slot_body(request: Request) -> JSONResponse:
    body = await _json_body(request)
    slot_id = body.get("slot_id")
    task_id = body.get("task_id")
    exit_status = int(body.get("exit_status", 0))
    artifacts = body.get("artifacts") or []
    error_message = body.get("error_message")
    if not slot_id or not task_id:
        raise HTTPException(status_code=400, detail="missing 'slot_id' or 'task_id'")
    return JSONResponse(status_code=200,
        content=await _do_release(slot_id, task_id, exit_status, artifacts, error_message))


@app.post("/release/{slot_id}/{task_id}")
async def release_slot_path(slot_id: str, task_id: str, request: Request) -> JSONResponse:
    body = await _json_body(request, allow_empty=True)
    exit_status = int(body.get("exit_status", 0))
    artifacts = body.get("artifacts") or []
    error_message = body.get("error_message")
    return JSONResponse(status_code=200,
        content=await _do_release(slot_id, task_id, exit_status, artifacts, error_message))


# ---------------------------------------------------------------------------
# /spawn-task — HTTP wrapper around _spawn_task_internal
# ---------------------------------------------------------------------------

@app.post("/spawn-task")
async def spawn_task(request: Request) -> JSONResponse:
    body = await _json_body(request)
    slot_id   = body.get("slot_id")
    task_spec = body.get("task_spec")
    force     = bool(body.get("force", False))
    explicit_task_id = body.get("task_id")
    parent_spawn_id  = body.get("parent_spawn_id")
    lineage_relation = body.get("lineage_relation") or (
        "decomposed-into" if parent_spawn_id else "autonomous-claim"
    )
    if not slot_id or not isinstance(task_spec, dict):
        raise HTTPException(status_code=400,
            detail="missing 'slot_id' or 'task_spec' (must be object)")

    # Resolve task_id from slot if not given (Phase 2 behaviour).
    effective_task_id = explicit_task_id
    if effective_task_id is None:
        with _db_lock:
            row = db().execute("SELECT current_task_id FROM slots WHERE slot_id = ?", (slot_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"unknown slot {slot_id!r}")
        effective_task_id = row["current_task_id"]
    if not effective_task_id:
        raise HTTPException(status_code=409, detail=f"slot {slot_id!r} has no current_task_id")

    result = await _spawn_task_internal(
        slot_id=slot_id, task_id=effective_task_id, task_spec=task_spec,
        force=force, parent_spawn_id=parent_spawn_id,
        lineage_relation=lineage_relation,
    )
    if result["ok"] or result.get("status_code") == 200:
        return JSONResponse(status_code=200, content=result)
    sc = result.get("status_code", 502)
    if sc == 429:
        return JSONResponse(status_code=429,
            headers={"Retry-After": "15"},
            content={**result, "retry_after_sec": 15})
    if sc == 451:
        raise HTTPException(status_code=451, detail=result.get("error", "subscription guard"))
    if sc in (502, 504):
        raise HTTPException(status_code=sc, detail=result)
    if sc == 503:
        raise HTTPException(status_code=503, detail=result.get("error"))
    if sc in (404, 409):
        raise HTTPException(status_code=sc, detail=result.get("error"))
    return JSONResponse(status_code=sc, content=result)


@app.get("/spawn-telemetry")
def spawn_telemetry_list(limit: int = Query(50, le=500),
                         bucket: str | None = Query(None),
                         host: str | None = Query(None),
                         outcome: str | None = Query(None)) -> dict[str, Any]:
    sql = "SELECT * FROM spawn_telemetry"
    args: list[Any] = []
    where: list[str] = []
    if bucket:
        where.append("bucket = ?"); args.append(bucket)
    if host:
        where.append("host = ?"); args.append(host)
    if outcome:
        where.append("outcome = ?"); args.append(outcome)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with _db_lock:
        rows = db().execute(sql, args).fetchall()
    return {"telemetry": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------------------------

def _do_heartbeat(slot_id: str, task_id: str) -> dict[str, Any]:
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            cur.execute(
                "UPDATE assignments SET last_heartbeat_at = CURRENT_TIMESTAMP WHERE slot_id = ? AND task_id = ? AND completed_at IS NULL",
                (slot_id, task_id),
            )
            updated = cur.rowcount
            if updated:
                cur.execute(
                    "INSERT INTO events (event_id, event_type, slot_id, task_id, bucket) "
                    "SELECT ?, 'heartbeat', slot_id, task_id, bucket FROM assignments "
                    "WHERE slot_id = ? AND task_id = ? AND completed_at IS NULL",
                    (str(uuid.uuid4()), slot_id, task_id),
                )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    if updated == 0:
        raise HTTPException(status_code=404, detail="no active assignment for slot/task")
    return {"slot_id": slot_id, "task_id": task_id, "ack_at": utcnow_iso()}


@app.post("/heartbeat")
async def heartbeat_body(request: Request) -> JSONResponse:
    body = await _json_body(request)
    slot_id = body.get("slot_id")
    task_id = body.get("task_id")
    if not slot_id or not task_id:
        raise HTTPException(status_code=400, detail="missing 'slot_id' or 'task_id'")
    return JSONResponse(content=_do_heartbeat(slot_id, task_id))


@app.post("/heartbeat/{slot_id}/{task_id}")
async def heartbeat_path(slot_id: str, task_id: str) -> JSONResponse:
    return JSONResponse(content=_do_heartbeat(slot_id, task_id))


@app.post("/webhooks/completion")
async def webhook_completion(request: Request) -> JSONResponse:
    body = await _json_body(request)
    slot_id = body.get("slot_id")
    task_id = body.get("task_id")
    exit_status = int(body.get("exit_status", 0))
    artifacts = body.get("artifacts") or []
    error_message = body.get("error_message")
    if not slot_id or not task_id:
        raise HTTPException(status_code=400, detail="missing 'slot_id' or 'task_id'")
    return JSONResponse(content=await _do_release(slot_id, task_id, exit_status, artifacts, error_message))


# ---------------------------------------------------------------------------
# Phase 4: /admin/spawn-completion (idempotent on spawn_id)
# ---------------------------------------------------------------------------

@app.post("/admin/spawn-completion")
async def admin_spawn_completion(request: Request) -> JSONResponse:
    """Mac spawner posts here on terminal states (incl. interrupted/recovery).

    Body shape (lifted from the spawner):
        {spawn_id, outcome, exit_code?, session_id?, model?, error?,
         binary_sha256?, binary_path?, slot_id?, task_id?}
    Idempotent: if the spawn_telemetry row is already terminal, returns 200
    with the existing record.
    """
    body = await _json_body(request)
    spawn_id = body.get("spawn_id")
    if not spawn_id:
        raise HTTPException(status_code=400, detail="missing 'spawn_id'")

    existing = _get_spawn_telemetry(spawn_id)
    if existing is None:
        # Spawner POSTed a callback for a spawn we never recorded.
        # Surface — likely a bug — but accept idempotently.
        log.warning("/admin/spawn-completion: unknown spawn_id=%s body=%s",
                    spawn_id, json.dumps(body)[:240])
        # Insert a stub so we have lineage.
        _record_spawn(spawn_id=spawn_id,
                      slot_id=body.get("slot_id"), task_id=body.get("task_id"),
                      bucket=body.get("bucket"), host=body.get("host"),
                      outcome="pending", api_key_guard_passed=True)
        existing = _get_spawn_telemetry(spawn_id)

    # Idempotency: if already completed, return existing record without mutation.
    if existing and existing.get("completed_at"):
        return JSONResponse(content={"ok": True, "idempotent": True, "telemetry": existing})

    # Map spawner outcome → slot-manager outcome.
    spawner_outcome = (body.get("outcome") or "").strip()
    exit_code       = body.get("exit_code")
    error           = body.get("error")
    if spawner_outcome == "ok" and exit_code in (None, 0):
        sm_outcome = "ok"
    elif spawner_outcome == "interrupted":
        sm_outcome = "interrupted"
    elif spawner_outcome == "timeout":
        sm_outcome = "timeout"
    elif spawner_outcome == "rejected_guard":
        sm_outcome = "rejected_guard"
    elif _is_cap_throttle_signal(error):
        sm_outcome = "cap_throttled"
    elif spawner_outcome in ("crashed", "failed", "spawner_error"):
        sm_outcome = "spawner_error"
    elif spawner_outcome == "":
        sm_outcome = "spawner_error"
    else:
        sm_outcome = "spawner_error"

    # Compute duration from started_at if present.
    duration_ms = None
    started_at = (existing or {}).get("started_at")
    if started_at:
        try:
            with _db_lock:
                row = db().execute(
                    "SELECT (strftime('%s','now') - strftime('%s', ?)) * 1000 AS d", (started_at,),
                ).fetchone()
                duration_ms = int(row["d"] or 0)
        except Exception:
            duration_ms = None
    if duration_ms is None:
        duration_ms = int(body.get("duration_ms") or 0)

    _complete_spawn(
        spawn_id=spawn_id,
        duration_ms=duration_ms,
        outcome=sm_outcome,
        exit_code=exit_code,
        binary_sha256=body.get("binary_sha256"),
        binary_path=body.get("binary_path"),
        session_id=body.get("session_id"),
        model=body.get("model"),
        error=error,
    )

    if sm_outcome == "cap_throttled":
        host = (existing or {}).get("host") or body.get("host")
        if host:
            _record_cap_event(host)

    # Best-effort: free the slot if it's still occupied for that spawn.
    slot_id = (existing or {}).get("slot_id") or body.get("slot_id")
    task_id = (existing or {}).get("task_id") or body.get("task_id")
    released = None
    if slot_id and task_id:
        released = _release_internal(slot_id, task_id,
                                      exit_status=int(exit_code or 0),
                                      error_message=error)

    log.info("/admin/spawn-completion: spawn_id=%s outcome=%s released_slot=%s",
             spawn_id, sm_outcome, bool(released))
    return JSONResponse(content={
        "ok": True, "idempotent": False,
        "spawn_id": spawn_id, "outcome": sm_outcome,
        "released_slot": bool(released),
        "telemetry": _get_spawn_telemetry(spawn_id),
    })


# ---------------------------------------------------------------------------
# Phase 4: lineage endpoints
# ---------------------------------------------------------------------------

@app.get("/spawn-lineage/{spawn_id}")
def spawn_lineage(spawn_id: str) -> dict[str, Any]:
    return _spawn_lineage_walk(spawn_id)


# ---------------------------------------------------------------------------
# Phase 4: dead-letter endpoints
# ---------------------------------------------------------------------------

@app.get("/admin/spawn-dead-letter")
def admin_dead_letter_list(
    bucket: str | None = Query(None),
    host: str | None = Query(None),
    limit: int = Query(100, le=500),
) -> dict[str, Any]:
    sql = "SELECT * FROM spawn_dead_letter WHERE replayed_at IS NULL"
    args: list[Any] = []
    if bucket:
        sql += " AND bucket = ?"; args.append(bucket)
    if host:
        sql += " AND host = ?"; args.append(host)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with _db_lock:
        rows = db().execute(sql, args).fetchall()
    return {"dead_letter": [dict(r) for r in rows]}


@app.post("/admin/spawn-dead-letter/{dl_id}/replay")
async def admin_dead_letter_replay(dl_id: int,
                                    actor: str = Query("operator"),
                                    reason: str = Query("")) -> JSONResponse:
    with _db_lock:
        row = db().execute(
            "SELECT * FROM spawn_dead_letter WHERE id = ? AND replayed_at IS NULL", (dl_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"dead-letter id={dl_id} not found or already replayed")
    bucket = row["bucket"]
    host = row["host"]
    try:
        spec = json.loads(row["payload"]) if row["payload"] else {}
    except Exception:
        spec = {}
    spec_id = spec.get("id") or row["task_id"]
    if not spec_id:
        raise HTTPException(status_code=400, detail="dead-letter row has no recoverable task_id")

    claimed = _claim_internal(bucket, task_id=spec_id, node_id=spec_id, event_type="dead_letter_replay")
    if claimed is None:
        raise HTTPException(status_code=503, detail="no free slot to replay into")
    _record_recent_claim()
    result = await _spawn_task_internal(
        slot_id=claimed["slot_id"], task_id=spec_id, task_spec=spec,
        parent_spawn_id=row["original_spawn_id"], lineage_relation="replay-of",
    )
    sm_outcome = result.get("outcome", "spawner_error")
    sps_alias = SPS_BUCKET_ALIASES.get(bucket, bucket)
    sps_outcome = ("done" if sm_outcome == "ok"
                   else "failed" if sm_outcome in ("rejected_guard",)
                   else "cancelled")
    await sps_post_completion(node_id=spec_id, bucket_alias=sps_alias,
                               outcome=sps_outcome,
                               outcome_detail=f"replay-of dl_id={dl_id} sm_outcome={sm_outcome}")
    _release_internal(claimed["slot_id"], spec_id,
                       exit_status=int(result.get("exit_code") or 0),
                       error_message=result.get("error"))
    with _db_lock:
        db().execute(
            "UPDATE spawn_dead_letter SET replayed_at = CURRENT_TIMESTAMP, replay_spawn_id = ? WHERE id = ?",
            (result.get("spawn_id"), dl_id),
        )
    log.info("dead-letter replay: dl_id=%d new_spawn_id=%s outcome=%s actor=%s",
             dl_id, result.get("spawn_id"), sm_outcome, actor)
    return JSONResponse(content={"ok": True, "dl_id": dl_id, "result": result, "actor": actor, "reason": reason})


# ---------------------------------------------------------------------------
# Phase 4: autonomy admin
# ---------------------------------------------------------------------------

@app.get("/admin/autonomy")
def admin_autonomy_get() -> dict[str, Any]:
    return _list_autonomy()


@app.post("/admin/autonomy/{bucket}")
def admin_autonomy_set(bucket: str,
                        state: str = Query(...),
                        actor: str = Query("operator"),
                        reason: str = Query("")) -> dict[str, Any]:
    if state not in ("on", "off"):
        raise HTTPException(status_code=400, detail="state must be on|off")
    return _set_autonomy(f"bucket:{bucket}", state, actor=actor, reason=reason)


@app.post("/admin/autonomy/global")
def admin_autonomy_global(state: str = Query(...),
                           actor: str = Query("operator"),
                           reason: str = Query("")) -> dict[str, Any]:
    if state not in ("on", "off"):
        raise HTTPException(status_code=400, detail="state must be on|off")
    return _set_autonomy("global", state, actor=actor, reason=reason)


# Operator-friendly aliases per the user's leg-prompt §5: /admin/loop/{enable,disable,status}.
@app.post("/admin/loop/enable")
def admin_loop_enable(actor: str = Query("operator"), reason: str = Query("")) -> dict[str, Any]:
    return _set_autonomy("global", "on", actor=actor, reason=reason)


@app.post("/admin/loop/disable")
def admin_loop_disable(actor: str = Query("operator"), reason: str = Query("")) -> dict[str, Any]:
    return _set_autonomy("global", "off", actor=actor, reason=reason)


@app.get("/admin/loop/status")
def admin_loop_status() -> dict[str, Any]:
    state = _list_autonomy()
    with _db_lock:
        recent = db().execute(
            "SELECT id, ts, claims, skips_no_work, skips_no_slot, skips_budget, skips_throttled, duration_ms "
            "  FROM loop_tick ORDER BY id DESC LIMIT 20"
        ).fetchall()
        ticks_total = db().execute("SELECT COUNT(*) AS n FROM loop_tick").fetchone()["n"]
        claims_total = db().execute("SELECT COALESCE(SUM(claims),0) AS n FROM loop_tick").fetchone()["n"]
        throttle_rows = db().execute(
            "SELECT host, cap_event_count, throttled_until FROM host_throttle_state"
        ).fetchall()
    return {
        "autonomy":          state,
        "loop_tick_total":   ticks_total,
        "loop_claims_total": claims_total,
        "loop_recent_ticks": [dict(r) for r in recent],
        "claim_rate_per_sec": _claim_rate_per_sec(),
        "host_throttle":     [dict(r) for r in throttle_rows],
    }


@app.get("/admin/loop/changes")
def admin_loop_changes(limit: int = Query(100, le=500)) -> dict[str, Any]:
    with _db_lock:
        rows = db().execute(
            "SELECT id, scope, old_state, new_state, actor, reason, changed_at FROM loop_changes "
            " ORDER BY id DESC LIMIT ?", (limit,),
        ).fetchall()
    return {"changes": [dict(r) for r in rows]}



# ---------------------------------------------------------------------------
# Phase 5: bucket_permissions / bucket_path_allowlists / approvals admin
# ---------------------------------------------------------------------------

@app.get("/admin/bucket-permissions")
def admin_bucket_permissions_list() -> dict[str, Any]:
    with _db_lock:
        rows = db().execute(
            "SELECT bucket, permission_mode, updated_at, actor, reason "
            "  FROM bucket_permissions ORDER BY bucket"
        ).fetchall()
    return {"permissions": [dict(r) for r in rows],
            "valid_modes": sorted(VALID_PERMISSION_MODES),
            "default_mode": DEFAULT_PERMISSION_MODE}


@app.post("/admin/bucket-permissions/{bucket}")
def admin_bucket_permissions_set(bucket: str,
                                 permission_mode: str = Query(...),
                                 actor: str = Query("operator"),
                                 reason: str = Query("")) -> dict[str, Any]:
    if permission_mode not in VALID_PERMISSION_MODES:
        raise HTTPException(status_code=400,
                            detail=f"permission_mode must be one of "
                                   f"{sorted(VALID_PERMISSION_MODES)}")
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "INSERT INTO bucket_permissions (bucket, permission_mode, actor, reason) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(bucket) DO UPDATE SET "
            "  permission_mode = excluded.permission_mode, "
            "  updated_at = CURRENT_TIMESTAMP, "
            "  actor = excluded.actor, "
            "  reason = excluded.reason",
            (bucket, permission_mode, actor, reason),
        )
    log.info("admin: bucket_permissions[%s] = %s (actor=%s reason=%s)",
             bucket, permission_mode, actor, reason)
    return {"bucket": bucket, "permission_mode": permission_mode,
            "actor": actor, "reason": reason}


@app.get("/admin/bucket-path-allowlists")
def admin_bucket_path_allowlists_list(bucket: str | None = None) -> dict[str, Any]:
    with _db_lock:
        if bucket:
            rows = db().execute(
                "SELECT id, bucket, path, active, created_at, actor, reason "
                "  FROM bucket_path_allowlists WHERE bucket = ? ORDER BY id",
                (bucket,),
            ).fetchall()
        else:
            rows = db().execute(
                "SELECT id, bucket, path, active, created_at, actor, reason "
                "  FROM bucket_path_allowlists ORDER BY bucket, id"
            ).fetchall()
    return {"allowlists": [dict(r) for r in rows]}


@app.post("/admin/bucket-path-allowlists")
def admin_bucket_path_allowlists_add(bucket: str = Query(...),
                                     path: str = Query(...),
                                     actor: str = Query("operator"),
                                     reason: str = Query("")) -> dict[str, Any]:
    bad = re.compile(r"^/etc(/|$)|^/var(/|$)|^/System(/|$)|^/usr(/|$)|"
                     r"^/Library(/|$)|^/boot(/|$)")
    if bad.match(path):
        raise HTTPException(status_code=400,
                            detail=f"path {path!r} matches blocklist")
    if not path.startswith("/"):
        raise HTTPException(status_code=400, detail="path must be absolute")
    with _db_lock:
        cur = db().cursor()
        try:
            cur.execute(
                "INSERT INTO bucket_path_allowlists "
                "  (bucket, path, actor, reason) VALUES (?, ?, ?, ?)",
                (bucket, path, actor, reason),
            )
            new_id = cur.lastrowid
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409,
                                detail=f"path already in allowlist for bucket={bucket!r}")
    return {"id": new_id, "bucket": bucket, "path": path}


@app.delete("/admin/bucket-path-allowlists/{row_id}")
def admin_bucket_path_allowlists_delete(row_id: int,
                                        actor: str = Query("operator"),
                                        reason: str = Query("")) -> dict[str, Any]:
    with _db_lock:
        cur = db().cursor()
        cur.execute("DELETE FROM bucket_path_allowlists WHERE id = ?", (row_id,))
        if cur.rowcount != 1:
            raise HTTPException(status_code=404, detail=f"id {row_id} not found")
    log.info("admin: bucket_path_allowlists DELETE id=%s actor=%s reason=%s",
             row_id, actor, reason)
    return {"id": row_id, "deleted": True}


@app.post("/admin/approve/{task_id}")
def admin_approve_task(task_id: str,
                       actor: str = Query(...),
                       reason: str = Query(...),
                       ttl_seconds: int = Query(APPROVAL_TTL_SEC,
                                                ge=60, le=86400),
                       ) -> dict[str, Any]:
    expires_at = (datetime.now(timezone.utc)
                  + timedelta(seconds=ttl_seconds)).strftime("%Y-%m-%d %H:%M:%S")
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "INSERT INTO task_approvals "
            "  (task_id, expires_at, actor, reason, used_at, used_spawn_id) "
            "VALUES (?, ?, ?, ?, NULL, NULL) "
            "ON CONFLICT(task_id) DO UPDATE SET "
            "  approved_at = CURRENT_TIMESTAMP, "
            "  expires_at = excluded.expires_at, "
            "  actor = excluded.actor, "
            "  reason = excluded.reason, "
            "  used_at = NULL, "
            "  used_spawn_id = NULL",
            (task_id, expires_at, actor, reason),
        )
    log.warning("admin: APPROVAL granted task=%s actor=%s reason=%s expires=%s",
                task_id, actor, reason, expires_at)
    return {"task_id": task_id, "expires_at": expires_at,
            "ttl_seconds": ttl_seconds, "actor": actor, "reason": reason}


@app.delete("/admin/approve/{task_id}")
def admin_revoke_task(task_id: str,
                      actor: str = Query("operator"),
                      reason: str = Query("")) -> dict[str, Any]:
    with _db_lock:
        cur = db().cursor()
        cur.execute("DELETE FROM task_approvals WHERE task_id = ?", (task_id,))
        deleted = cur.rowcount
    log.warning("admin: APPROVAL revoked task=%s actor=%s reason=%s deleted=%d",
                task_id, actor, reason, deleted)
    return {"task_id": task_id, "deleted": deleted}


@app.get("/admin/approvals")
def admin_approvals_list(include_used: bool = False) -> dict[str, Any]:
    sql = ("SELECT task_id, approved_at, expires_at, actor, reason, "
           "       used_at, used_spawn_id FROM task_approvals ")
    if not include_used:
        sql += " WHERE used_at IS NULL "
    sql += " ORDER BY approved_at DESC LIMIT 200"
    with _db_lock:
        rows = db().execute(sql).fetchall()
    return {"approvals": [dict(r) for r in rows],
            "ttl_seconds_default": APPROVAL_TTL_SEC}


@app.post("/admin/risk-classify")
async def admin_risk_classify(req: Request) -> dict[str, Any]:
    body = await req.json()
    task_spec = body.get("task_spec") or body
    bucket = body.get("bucket") or task_spec.get("target_bucket") or task_spec.get("bucket") or "M1"
    for short, alias in SPS_BUCKET_ALIASES.items():
        if bucket == alias:
            bucket = short
            break
    permission_mode = (task_spec.get("permission_mode")
                       or _bucket_permission_mode(bucket))
    allow_list = _bucket_allow_list(bucket, repo_scope=task_spec.get("repo_scope"))
    risk_tier, classifier = _classify_risk_tier(task_spec)
    approved = _check_approval(task_spec.get("id") or task_spec.get("task_id") or "")
    return {
        "bucket": bucket,
        "permission_mode": permission_mode,
        "allow_list": allow_list,
        "risk_tier": risk_tier,
        "classifier": classifier,
        "approval_status": approved,
    }


@app.get("/admin/dispatch-risk-log")
def admin_dispatch_risk_log(limit: int = Query(100, ge=1, le=1000),
                             tier: str | None = None) -> dict[str, Any]:
    sql = ("SELECT id, spawn_id, task_id, bucket, risk_tier, "
           "       permission_mode, classifier, approval_used, "
           "       allow_list_json, created_at "
           "  FROM dispatch_risk_log ")
    args: list[Any] = []
    if tier:
        sql += " WHERE risk_tier = ? "
        args.append(tier)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with _db_lock:
        rows = db().execute(sql, args).fetchall()
    return {"dispatches": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# Phase 4: spawn-retry-budget admin
# ---------------------------------------------------------------------------

@app.get("/spawn-retry-budget")
def spawn_retry_budget_list() -> dict[str, Any]:
    with _db_lock:
        rows = db().execute(
            "SELECT bucket, host, max_retries, backoff_s_csv, updated_at FROM spawn_retry_budget"
        ).fetchall()
    return {"retry_budgets": [dict(r) for r in rows]}


@app.post("/spawn-retry-budget")
def spawn_retry_budget_set(bucket: str = Query(...),
                            host: str = Query(...),
                            max_retries: int = Query(..., ge=0, le=20),
                            backoff_s_csv: str = Query("1,2,4")) -> dict[str, Any]:
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "INSERT INTO spawn_retry_budget (bucket, host, max_retries, backoff_s_csv) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(bucket, host) DO UPDATE SET max_retries = excluded.max_retries, "
            "                                       backoff_s_csv = excluded.backoff_s_csv, "
            "                                       updated_at = CURRENT_TIMESTAMP",
            (bucket, host, max_retries, backoff_s_csv),
        )
    return {"bucket": bucket, "host": host, "max_retries": max_retries, "backoff_s_csv": backoff_s_csv}


# ---------------------------------------------------------------------------
# Phase 1/2 admin endpoints (capacity, budget, host federation) — unchanged
# ---------------------------------------------------------------------------

@app.post("/capacity")
def capacity_admin(
    bucket: str = Query(...),
    value: int  = Query(..., ge=0, le=256),
    actor: str  = Query("operator"),
    reason: str = Query(""),
) -> JSONResponse:
    new_capacity = int(value)
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            existing = cur.execute(
                "SELECT slot_id, index_in_bucket, status FROM slots WHERE bucket = ? ORDER BY index_in_bucket",
                (bucket,),
            ).fetchall()
            old_capacity = sum(1 for r in existing if r["status"] != "disabled")
            old_max_idx  = max((r["index_in_bucket"] for r in existing), default=0)
            disabled_now: list[str] = []
            added_now:    list[str] = []
            host_for_new = DEFAULT_HOST_FOR_BUCKET.get(bucket, bucket)
            cfg = load_config()
            buckets_cfg = cfg.get("buckets") or {}
            if bucket in buckets_cfg and "host" in buckets_cfg[bucket]:
                host_for_new = buckets_cfg[bucket]["host"]
            if new_capacity > old_max_idx:
                lease = LEASE_TTL_SEC
                for idx in range(old_max_idx + 1, new_capacity + 1):
                    sid = f"{bucket}-{idx}"
                    cur.execute(
                        "INSERT OR IGNORE INTO slots (slot_id, bucket, index_in_bucket, status, lease_seconds, host) VALUES (?, ?, ?, 'free', ?, ?)",
                        (sid, bucket, idx, lease, host_for_new),
                    )
                    added_now.append(sid)
                for r in existing:
                    if r["status"] == "disabled" and r["index_in_bucket"] <= new_capacity:
                        cur.execute(
                            "UPDATE slots SET status='free', last_updated_at = CURRENT_TIMESTAMP WHERE slot_id = ?",
                            (r["slot_id"],),
                        )
                        added_now.append(r["slot_id"])
            elif new_capacity < old_capacity:
                free_above = [r for r in reversed(existing)
                              if r["index_in_bucket"] > new_capacity and r["status"] == "free"]
                for r in free_above:
                    cur.execute(
                        "UPDATE slots SET status='disabled', last_updated_at = CURRENT_TIMESTAMP WHERE slot_id = ?",
                        (r["slot_id"],),
                    )
                    disabled_now.append(r["slot_id"])
            cur.execute(
                "INSERT INTO capacity_changes (bucket, old_capacity, new_capacity, actor, reason) VALUES (?, ?, ?, ?, ?)",
                (bucket, old_capacity, new_capacity, actor, reason),
            )
            cur.execute(
                "INSERT INTO events (event_id, event_type, bucket, payload) VALUES (?, 'capacity_change', ?, ?)",
                (str(uuid.uuid4()), bucket,
                 json.dumps({"old": old_capacity, "new": new_capacity,
                             "added": added_now, "disabled": disabled_now,
                             "actor": actor, "reason": reason})),
            )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    with _db_lock:
        effective = db().execute(
            "SELECT COUNT(*) AS n FROM slots WHERE bucket = ? AND status != 'disabled'",
            (bucket,),
        ).fetchone()["n"]
    log.info("capacity: bucket=%s old=%d new=%d effective=%d added=%d disabled=%d actor=%s reason=%s",
             bucket, old_capacity, new_capacity, effective,
             len(added_now), len(disabled_now), actor, reason)
    return JSONResponse(content={
        "bucket": bucket, "old_capacity": old_capacity, "new_capacity": new_capacity,
        "effective_capacity": effective, "added": added_now, "disabled": disabled_now,
        "actor": actor, "reason": reason, "changed_at": utcnow_iso(),
    })


@app.get("/capacity/history")
def capacity_history(bucket: str | None = Query(None), limit: int = Query(100, le=500)):
    sql = "SELECT id, bucket, old_capacity, new_capacity, actor, reason, changed_at FROM capacity_changes"
    args: list[Any] = []
    if bucket:
        sql += " WHERE bucket = ?"
        args.append(bucket)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with _db_lock:
        rows = db().execute(sql, args).fetchall()
    return {"history": [dict(r) for r in rows]}


@app.get("/spawn-budget")
def spawn_budget_get(bucket: str = Query(...)) -> dict[str, Any]:
    with _db_lock:
        cur = db().cursor()
        cur.execute("BEGIN;")
        try:
            state = _budget_refill_locked(cur, bucket)
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    if state is None:
        raise HTTPException(status_code=404, detail=f"no spawn-budget row for bucket {bucket!r}")
    return state


@app.post("/spawn-budget")
def spawn_budget_set(bucket: str = Query(...),
                      max_per_minute: int = Query(..., ge=0, le=600),
                      actor: str = Query("operator"),
                      reason: str = Query("")) -> dict[str, Any]:
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            old = cur.execute(
                "SELECT max_per_minute FROM spawn_budget WHERE bucket = ?", (bucket,),
            ).fetchone()
            old_max = old["max_per_minute"] if old else None
            if old is None:
                cur.execute(
                    "INSERT INTO spawn_budget (bucket, max_per_minute, tokens_remaining) VALUES (?, ?, ?)",
                    (bucket, max_per_minute, float(max_per_minute)),
                )
            else:
                cur.execute(
                    "UPDATE spawn_budget "
                    "   SET max_per_minute = ?, "
                    "       tokens_remaining = MIN(tokens_remaining, ?), "
                    "       updated_at = CURRENT_TIMESTAMP "
                    " WHERE bucket = ?",
                    (max_per_minute, float(max_per_minute), bucket),
                )
            cur.execute(
                "INSERT INTO spawn_budget_changes (bucket, old_max_per_minute, new_max_per_minute, actor, reason) "
                "VALUES (?, ?, ?, ?, ?)",
                (bucket, old_max, max_per_minute, actor, reason),
            )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    log.info("spawn-budget: bucket=%s old=%s new=%d actor=%s reason=%s",
             bucket, old_max, max_per_minute, actor, reason)
    with _db_lock:
        cur = db().cursor()
        cur.execute("BEGIN;")
        try:
            state = _budget_refill_locked(cur, bucket)
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    return {"changed_at": utcnow_iso(), "old_max_per_minute": old_max, **(state or {})}


@app.get("/spawn-budget/history")
def spawn_budget_history(bucket: str | None = Query(None), limit: int = Query(100, le=500)) -> dict[str, Any]:
    sql = "SELECT id, bucket, old_max_per_minute, new_max_per_minute, actor, reason, changed_at FROM spawn_budget_changes"
    args: list[Any] = []
    if bucket:
        sql += " WHERE bucket = ?"; args.append(bucket)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with _db_lock:
        rows = db().execute(sql, args).fetchall()
    return {"history": [dict(r) for r in rows]}


@app.post("/admin/host/register")
async def host_register(request: Request) -> JSONResponse:
    body = await _json_body(request)
    name        = body.get("name")
    spawner_url = body.get("spawner_url")
    hostname    = body.get("hostname")
    version_str = body.get("version")
    notes       = body.get("notes")
    if not name or not spawner_url:
        raise HTTPException(status_code=400, detail="missing 'name' or 'spawner_url'")
    with _db_lock:
        conn = db()
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            existed = cur.execute("SELECT 1 FROM hosts WHERE name = ?", (name,)).fetchone()
            if existed:
                cur.execute(
                    "UPDATE hosts SET spawner_url = ?, hostname = ?, version = ?, notes = ?, "
                    "                 state = 'active', last_heartbeat_at = CURRENT_TIMESTAMP, "
                    "                 last_state_change_at = CURRENT_TIMESTAMP "
                    " WHERE name = ?",
                    (spawner_url, hostname, version_str, notes, name),
                )
            else:
                cur.execute(
                    "INSERT INTO hosts (name, spawner_url, hostname, version, notes, state) "
                    "VALUES (?, ?, ?, ?, ?, 'active')",
                    (name, spawner_url, hostname, version_str, notes),
                )
            cur.execute(
                "INSERT INTO events (event_id, event_type, payload) VALUES (?, 'host_register', ?)",
                (str(uuid.uuid4()),
                 json.dumps({"name": name, "spawner_url": spawner_url, "version": version_str})),
            )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    log.info("host register: name=%s spawner_url=%s version=%s", name, spawner_url, version_str)
    return JSONResponse(content={
        "name": name, "spawner_url": spawner_url, "state": "active",
        "registered_at": utcnow_iso(),
    })


@app.post("/admin/host/heartbeat")
async def host_heartbeat(request: Request) -> JSONResponse:
    body = await _json_body(request)
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="missing 'name'")
    with _db_lock:
        cur = db().cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            row = cur.execute("SELECT state FROM hosts WHERE name = ?", (name,)).fetchone()
            if row is None:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail=f"host {name!r} not registered")
            new_state = "active" if row["state"] == "offline" else row["state"]
            cur.execute(
                "UPDATE hosts SET last_heartbeat_at = CURRENT_TIMESTAMP, "
                "                 state = ?, last_state_change_at = "
                "                       CASE WHEN state = ? THEN last_state_change_at "
                "                            ELSE CURRENT_TIMESTAMP END "
                " WHERE name = ?",
                (new_state, new_state, name),
            )
            cur.execute("COMMIT;")
        except HTTPException:
            raise
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    return JSONResponse(content={"name": name, "state": new_state, "ack_at": utcnow_iso()})


@app.get("/admin/hosts")
def hosts_list() -> dict[str, Any]:
    with _db_lock:
        rows = db().execute(
            "SELECT name, spawner_url, hostname, version, state, "
            "       registered_at, last_heartbeat_at, last_state_change_at, notes "
            "  FROM hosts ORDER BY name"
        ).fetchall()
    return {"hosts": [dict(r) for r in rows]}


@app.get("/admin/host/{name}")
def host_get(name: str) -> dict[str, Any]:
    with _db_lock:
        row = db().execute(
            "SELECT name, spawner_url, hostname, version, state, "
            "       registered_at, last_heartbeat_at, last_state_change_at, notes "
            "  FROM hosts WHERE name = ?",
            (name,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"host {name!r} not registered")
    return dict(row)


@app.post("/admin/host/{name}/state")
def host_set_state(name: str,
                    state: str = Query(...),
                    actor: str = Query("operator"),
                    reason: str = Query("")) -> dict[str, Any]:
    if state not in ("active", "drain", "disabled", "offline"):
        raise HTTPException(status_code=400,
            detail="state must be one of active|drain|disabled|offline")
    with _db_lock:
        cur = db().cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            row = cur.execute("SELECT state FROM hosts WHERE name = ?", (name,)).fetchone()
            if row is None:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail=f"host {name!r} not registered")
            old_state = row["state"]
            cur.execute(
                "UPDATE hosts SET state = ?, last_state_change_at = CURRENT_TIMESTAMP WHERE name = ?",
                (state, name),
            )
            cur.execute(
                "INSERT INTO events (event_id, event_type, payload) VALUES (?, 'host_state_change', ?)",
                (str(uuid.uuid4()),
                 json.dumps({"host": name, "old": old_state, "new": state, "actor": actor, "reason": reason})),
            )
            cur.execute("COMMIT;")
        except HTTPException:
            raise
        except Exception:
            cur.execute("ROLLBACK;")
            raise
    log.info("host state change: name=%s %s -> %s actor=%s reason=%s",
             name, old_state, state, actor, reason)
    return {"name": name, "old_state": old_state, "new_state": state, "actor": actor,
            "reason": reason, "changed_at": utcnow_iso()}


# ---------------------------------------------------------------------------
# Metrics (Phase 4 expanded)
# ---------------------------------------------------------------------------

def _gather_metrics() -> dict[str, Any]:
    with _db_lock:
        conn = db()
        rows = conn.execute(
            "SELECT bucket, status, COUNT(*) AS n FROM slots GROUP BY bucket, status"
        ).fetchall()
        active = conn.execute(
            "SELECT bucket, COUNT(*) AS n FROM assignments WHERE completed_at IS NULL GROUP BY bucket"
        ).fetchall()
        claims_by_bucket = conn.execute(
            "SELECT bucket, COUNT(*) AS n FROM events "
            "WHERE event_type IN ('task_spawned','autonomous_claim') "
            "  AND strftime('%s','now') - strftime('%s', created_at) < 3600 "
            "GROUP BY bucket"
        ).fetchall()
        releases_by_bucket = conn.execute(
            "SELECT bucket, COUNT(*) AS n FROM events "
            "WHERE event_type = 'slot_released' "
            "  AND strftime('%s','now') - strftime('%s', created_at) < 3600 "
            "GROUP BY bucket"
        ).fetchall()
        watchdog_by_bucket = conn.execute(
            "SELECT bucket, event_type, COUNT(*) AS n FROM events "
            "WHERE event_type IN ('heartbeat_timeout','lease_expired') "
            "  AND strftime('%s','now') - strftime('%s', created_at) < 3600 "
            "GROUP BY bucket, event_type"
        ).fetchall()
        started = conn.execute(
            "SELECT bucket, host, COUNT(*) AS n FROM spawn_telemetry "
            "GROUP BY bucket, host"
        ).fetchall()
        completed = conn.execute(
            "SELECT bucket, host, outcome, COALESCE(exit_code,-1) AS exit_code, COUNT(*) AS n "
            "  FROM spawn_telemetry WHERE completed_at IS NOT NULL "
            "GROUP BY bucket, host, outcome, exit_code"
        ).fetchall()
        duration_rows = conn.execute(
            "SELECT bucket, host, duration_ms FROM spawn_telemetry "
            "WHERE duration_ms IS NOT NULL AND outcome NOT IN ('rejected_guard','rejected_budget')"
        ).fetchall()
        budget_rows = conn.execute(
            "SELECT bucket, max_per_minute, tokens_remaining FROM spawn_budget"
        ).fetchall()
        host_rows = conn.execute("SELECT name, state FROM hosts").fetchall()
        # Phase 4 — autonomy + loop metrics.
        autonomy_rows = conn.execute(
            "SELECT scope, state FROM autonomy_state"
        ).fetchall()
        tick_total = conn.execute("SELECT COUNT(*) AS n FROM loop_tick").fetchone()["n"]
        claim_total = conn.execute("SELECT COALESCE(SUM(claims),0) AS n FROM loop_tick").fetchone()["n"]
        skip_totals = conn.execute(
            "SELECT COALESCE(SUM(skips_no_work),0) AS no_work, "
            "       COALESCE(SUM(skips_no_slot),0) AS no_slot, "
            "       COALESCE(SUM(skips_budget),0) AS budget, "
            "       COALESCE(SUM(skips_throttled),0) AS throttled "
            "  FROM loop_tick"
        ).fetchone()
        tick_dur = conn.execute(
            "SELECT COALESCE(SUM(duration_ms),0) AS sum_ms, "
            "       COALESCE(MAX(duration_ms),0) AS max_ms, "
            "       COUNT(*) AS n "
            "  FROM loop_tick"
        ).fetchone()
        dl_total = conn.execute(
            "SELECT COUNT(*) AS n FROM spawn_dead_letter WHERE replayed_at IS NULL"
        ).fetchone()["n"]
        host_throttle_rows = conn.execute(
            "SELECT host, cap_event_count, throttled_until FROM host_throttle_state"
        ).fetchall()

    by_bucket: dict[str, dict[str, int]] = {}
    for r in rows:
        st = by_bucket.setdefault(r["bucket"], {})
        st[r["status"]] = r["n"]
    summary: dict[str, dict[str, int]] = {}
    for bucket, statuses in by_bucket.items():
        total      = sum(statuses.values())
        free       = statuses.get("free", 0)
        occupied   = statuses.get("occupied", 0)
        claimed    = statuses.get("claimed", 0)
        disabled   = statuses.get("disabled", 0)
        in_use     = occupied + claimed
        summary[bucket] = {"total": total, "free": free, "in_use": in_use,
                           "occupied": occupied, "claimed": claimed, "disabled": disabled}
    active_map = {r["bucket"]: r["n"] for r in active}
    claim_rate = {r["bucket"]: r["n"] for r in claims_by_bucket}
    release_rate = {r["bucket"]: r["n"] for r in releases_by_bucket}
    watchdog_rate: dict[str, dict[str, int]] = {}
    for r in watchdog_by_bucket:
        watchdog_rate.setdefault(r["bucket"], {})[r["event_type"]] = r["n"]
    spawn_started: dict[tuple[str, str], int] = {}
    for r in started:
        spawn_started[(r["bucket"] or "", r["host"] or "")] = r["n"]
    spawn_completed: list[dict[str, Any]] = [
        {"bucket": r["bucket"] or "", "host": r["host"] or "",
         "outcome": r["outcome"], "exit_code": r["exit_code"], "n": r["n"]}
        for r in completed
    ]
    histogram: dict[tuple[str, str], dict[str, Any]] = {}
    for r in duration_rows:
        key = (r["bucket"] or "", r["host"] or "")
        h = histogram.setdefault(key, {"count": 0, "sum_s": 0.0,
                                       "buckets": {b: 0 for b in SPAWN_DURATION_BUCKETS_S}})
        s = (r["duration_ms"] or 0) / 1000.0
        h["count"] += 1
        h["sum_s"] += s
        for b in SPAWN_DURATION_BUCKETS_S:
            if s <= b:
                h["buckets"][b] += 1
    spawn_budget = {r["bucket"]: {"max_per_minute": r["max_per_minute"],
                                  "tokens_remaining": r["tokens_remaining"]}
                    for r in budget_rows}
    hosts = [{"name": r["name"], "state": r["state"]} for r in host_rows]
    autonomy = {r["scope"]: r["state"] for r in autonomy_rows}
    return {
        "summary":                summary,
        "active_assignments":     active_map,
        "claims_per_hour":        claim_rate,
        "releases_per_hour":      release_rate,
        "watchdog_releases_per_hour": watchdog_rate,
        "spawn_started":          spawn_started,
        "spawn_completed":        spawn_completed,
        "spawn_duration_hist":    histogram,
        "spawn_budget":           spawn_budget,
        "hosts":                  hosts,
        "autonomy":               autonomy,
        "loop_tick_total":        tick_total,
        "loop_claims_total":      claim_total,
        "loop_skip_totals":       dict(skip_totals) if skip_totals else {},
        "loop_duration_sum_ms":   int((tick_dur or {})["sum_ms"] or 0) if tick_dur else 0,
        "loop_duration_count":    int((tick_dur or {})["n"] or 0) if tick_dur else 0,
        "loop_duration_max_ms":   int((tick_dur or {})["max_ms"] or 0) if tick_dur else 0,
        "dead_letter_open":       dl_total,
        "host_throttle":          [dict(r) for r in host_throttle_rows],
        "claim_rate_per_sec":     _claim_rate_per_sec(),
    }


@app.get("/metrics", response_class=PlainTextResponse)
def metrics() -> str:
    m = _gather_metrics()
    lines: list[str] = []
    lines += [
        "# HELP slot_capacity_total Total slots per bucket",
        "# TYPE slot_capacity_total gauge",
    ]
    for bucket, s in m["summary"].items():
        lines.append(f'slot_capacity_total{{bucket="{bucket}"}} {s["total"]}')
    lines += [
        "# HELP slot_status_total Slots per bucket per status",
        "# TYPE slot_status_total gauge",
    ]
    for bucket, s in m["summary"].items():
        for status in ("free", "claimed", "occupied", "draining", "disabled"):
            lines.append(f'slot_status_total{{bucket="{bucket}",status="{status}"}} {s.get(status, 0)}')
    lines += [
        "# HELP slot_in_use_total In-use slots (occupied+claimed)",
        "# TYPE slot_in_use_total gauge",
    ]
    for bucket, s in m["summary"].items():
        lines.append(f'slot_in_use_total{{bucket="{bucket}"}} {s["in_use"]}')
    lines += [
        "# HELP slot_free_total Free slots",
        "# TYPE slot_free_total gauge",
    ]
    for bucket, s in m["summary"].items():
        lines.append(f'slot_free_total{{bucket="{bucket}"}} {s["free"]}')
    lines += [
        "# HELP active_assignments_total Currently-running assignments per bucket",
        "# TYPE active_assignments_total gauge",
    ]
    for bucket, n in m["active_assignments"].items():
        lines.append(f'active_assignments_total{{bucket="{bucket}"}} {n}')
    lines += [
        "# HELP slot_claims_per_hour Claims observed in the last 1h",
        "# TYPE slot_claims_per_hour gauge",
    ]
    for bucket, n in m["claims_per_hour"].items():
        lines.append(f'slot_claims_per_hour{{bucket="{bucket}"}} {n}')
    lines += [
        "# HELP slot_releases_per_hour Releases observed in the last 1h",
        "# TYPE slot_releases_per_hour gauge",
    ]
    for bucket, n in m["releases_per_hour"].items():
        lines.append(f'slot_releases_per_hour{{bucket="{bucket}"}} {n}')
    lines += [
        "# HELP watchdog_releases_per_hour Watchdog auto-releases in the last 1h",
        "# TYPE watchdog_releases_per_hour gauge",
    ]
    for bucket, et_map in m["watchdog_releases_per_hour"].items():
        for ev, n in et_map.items():
            lines.append(f'watchdog_releases_per_hour{{bucket="{bucket}",reason="{ev}"}} {n}')
    lines += [
        "# HELP slot_spawn_started_total Total /spawn-task calls accepted past guard",
        "# TYPE slot_spawn_started_total counter",
    ]
    for (bucket, host), n in m["spawn_started"].items():
        lines.append(f'slot_spawn_started_total{{bucket="{bucket}",host="{host}"}} {n}')
    lines += [
        "# HELP slot_spawn_completed_total /spawn-task outcomes (terminal).",
        "# TYPE slot_spawn_completed_total counter",
    ]
    for r in m["spawn_completed"]:
        lines.append(
            f'slot_spawn_completed_total{{bucket="{r["bucket"]}",host="{r["host"]}",'
            f'outcome="{r["outcome"]}",exit_code="{r["exit_code"]}"}} {r["n"]}'
        )
    lines += [
        "# HELP slot_spawn_duration_seconds Spawn end-to-end duration (slot-manager view).",
        "# TYPE slot_spawn_duration_seconds histogram",
    ]
    for (bucket, host), h in m["spawn_duration_hist"].items():
        for b in SPAWN_DURATION_BUCKETS_S:
            lines.append(
                f'slot_spawn_duration_seconds_bucket{{bucket="{bucket}",host="{host}",le="{b}"}} {h["buckets"][b]}'
            )
        lines.append(
            f'slot_spawn_duration_seconds_bucket{{bucket="{bucket}",host="{host}",le="+Inf"}} {h["count"]}'
        )
        lines.append(
            f'slot_spawn_duration_seconds_sum{{bucket="{bucket}",host="{host}"}} {h["sum_s"]:.6f}'
        )
        lines.append(
            f'slot_spawn_duration_seconds_count{{bucket="{bucket}",host="{host}"}} {h["count"]}'
        )
    lines += [
        "# HELP spawn_budget_max_per_minute Configured spawn budget per bucket",
        "# TYPE spawn_budget_max_per_minute gauge",
    ]
    for bucket, s in m["spawn_budget"].items():
        lines.append(f'spawn_budget_max_per_minute{{bucket="{bucket}"}} {s["max_per_minute"]}')
    lines += [
        "# HELP spawn_budget_tokens_remaining Live token bucket reservoir",
        "# TYPE spawn_budget_tokens_remaining gauge",
    ]
    for bucket, s in m["spawn_budget"].items():
        lines.append(f'spawn_budget_tokens_remaining{{bucket="{bucket}"}} {s["tokens_remaining"]:.4f}')
    state_counts: dict[str, int] = {}
    for h in m["hosts"]:
        state_counts[h["state"]] = state_counts.get(h["state"], 0) + 1
    lines += [
        "# HELP slot_manager_hosts_total Registered spawner hosts by state",
        "# TYPE slot_manager_hosts_total gauge",
    ]
    for state, n in state_counts.items():
        lines.append(f'slot_manager_hosts_total{{state="{state}"}} {n}')

    # Phase 4 — autonomy + loop metrics.
    lines += [
        "# HELP slot_manager_autonomy_state 0/1 boolean per scope (1=on, 0=off, 2=circuit-broken, 3=cap-throttled)",
        "# TYPE slot_manager_autonomy_state gauge",
    ]
    state_value = {"on": 1, "off": 0, "circuit-broken": 2, "cap-throttled": 3}
    for scope, st in m["autonomy"].items():
        v = state_value.get(st, -1)
        lines.append(f'slot_manager_autonomy_state{{scope="{scope}",state="{st}"}} {v}')
    lines += [
        "# HELP slot_loop_iterations_total Total autonomous-loop ticks",
        "# TYPE slot_loop_iterations_total counter",
        f'slot_loop_iterations_total {m["loop_tick_total"]}',
        "# HELP slot_loop_claims_total Total autonomous claims dispatched",
        "# TYPE slot_loop_claims_total counter",
        f'slot_loop_claims_total {m["loop_claims_total"]}',
        "# HELP slot_loop_skips_total Total autonomous-loop skips by reason",
        "# TYPE slot_loop_skips_total counter",
    ]
    for reason, n in (m.get("loop_skip_totals") or {}).items():
        lines.append(f'slot_loop_skips_total{{reason="{reason}"}} {n}')
    lines += [
        "# HELP slot_loop_duration_seconds Autonomous-loop tick duration (seconds; sum/count)",
        "# TYPE slot_loop_duration_seconds histogram",
        f'slot_loop_duration_seconds_sum {m["loop_duration_sum_ms"]/1000.0:.3f}',
        f'slot_loop_duration_seconds_count {m["loop_duration_count"]}',
        f'slot_loop_duration_seconds_max {m["loop_duration_max_ms"]/1000.0:.3f}',
        "# HELP slot_manager_claim_rate_per_sec Rolling claim rate over the circuit-breaker window",
        "# TYPE slot_manager_claim_rate_per_sec gauge",
        f'slot_manager_claim_rate_per_sec {m["claim_rate_per_sec"]:.6f}',
        "# HELP slot_manager_dead_letter_open Open (un-replayed) dead-letter rows",
        "# TYPE slot_manager_dead_letter_open gauge",
        f'slot_manager_dead_letter_open {m["dead_letter_open"]}',
    ]
    for h in m["host_throttle"]:
        lines.append(f'slot_manager_host_cap_event_count{{host="{h["host"]}"}} {h["cap_event_count"]}')
    lines += [
        "# HELP slot_manager_up Liveness sentinel",
        "# TYPE slot_manager_up gauge",
        "slot_manager_up 1",
        "",
    ]
    return "\n".join(lines)


@app.get("/metrics.json")
def metrics_json() -> dict[str, Any]:
    m = _gather_metrics()
    return {
        **{k: v for k, v in m.items() if k not in ("spawn_started", "spawn_duration_hist")},
        "spawn_started": [
            {"bucket": k[0], "host": k[1], "n": v} for k, v in m["spawn_started"].items()
        ],
        "spawn_duration_hist": [
            {"bucket": k[0], "host": k[1],
             "count": v["count"], "sum_s": v["sum_s"],
             "buckets": v["buckets"]}
            for k, v in m["spawn_duration_hist"].items()
        ],
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _json_body(request: Request, *, allow_empty: bool = False) -> dict[str, Any]:
    try:
        raw = await request.body()
        if not raw:
            return {}
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        return data
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid JSON: {e}")


# ---------------------------------------------------------------------------
# Test hooks
# ---------------------------------------------------------------------------

@app.post("/admin/test/expire-heartbeat")
def admin_expire_heartbeat(slot_id: str = Query(...), seconds_ago: int = Query(...)):
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "UPDATE assignments SET last_heartbeat_at = datetime('now', ? || ' seconds') "
            "WHERE slot_id = ? AND completed_at IS NULL",
            (f"-{int(seconds_ago)}", slot_id),
        )
        updated = cur.rowcount
    return {"slot_id": slot_id, "updated": updated, "seconds_ago": seconds_ago}


@app.post("/admin/test/expire-lease")
def admin_expire_lease(slot_id: str = Query(...), seconds_ago: int = Query(...)):
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "UPDATE assignments SET started_at = datetime('now', ? || ' seconds'), "
            "last_heartbeat_at = CURRENT_TIMESTAMP "
            "WHERE slot_id = ? AND completed_at IS NULL",
            (f"-{int(seconds_ago)}", slot_id),
        )
        updated = cur.rowcount
    return {"slot_id": slot_id, "updated": updated, "seconds_ago": seconds_ago}


@app.post("/admin/test/set-lease")
def admin_set_lease(slot_id: str = Query(...), lease_seconds: int = Query(..., ge=1)):
    with _db_lock:
        cur = db().cursor()
        cur.execute("UPDATE slots SET lease_seconds = ? WHERE slot_id = ?",
                    (lease_seconds, slot_id))
        updated = cur.rowcount
    return {"slot_id": slot_id, "lease_seconds": lease_seconds, "updated": updated}


@app.post("/admin/test/run-watchdog")
def admin_run_watchdog():
    hb = _watchdog_sweep_heartbeat()
    le = _watchdog_sweep_lease()
    ho = _watchdog_sweep_hosts()
    cap = _watchdog_clear_expired_throttles()
    return {"heartbeat_released": hb, "lease_released": le,
            "hosts_offlined": ho, "cap_cleared": cap}


@app.post("/admin/test/expire-host")
def admin_expire_host(name: str = Query(...), seconds_ago: int = Query(...)):
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "UPDATE hosts SET last_heartbeat_at = datetime('now', ? || ' seconds') WHERE name = ?",
            (f"-{int(seconds_ago)}", name),
        )
        updated = cur.rowcount
    return {"name": name, "updated": updated, "seconds_ago": seconds_ago}


@app.post("/admin/test/set-budget-tokens")
def admin_set_budget_tokens(bucket: str = Query(...), tokens: float = Query(..., ge=0)):
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "UPDATE spawn_budget SET tokens_remaining = ?, last_refill_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP "
            " WHERE bucket = ?",
            (float(tokens), bucket),
        )
        updated = cur.rowcount
    return {"bucket": bucket, "tokens_remaining": float(tokens), "updated": updated}


@app.post("/admin/test/set-slot-host")
def admin_set_slot_host(slot_id: str = Query(...), host: str = Query(...)):
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "UPDATE slots SET host = ?, last_updated_at = CURRENT_TIMESTAMP WHERE slot_id = ?",
            (host, slot_id),
        )
        updated = cur.rowcount
    return {"slot_id": slot_id, "host": host, "updated": updated}


@app.post("/admin/test/clear-host-throttle")
def admin_clear_throttle(host: str = Query(...)):
    """Phase 4: operator override — clear cap-throttle on a host immediately."""
    with _db_lock:
        cur = db().cursor()
        cur.execute(
            "UPDATE host_throttle_state SET cap_event_count = 0, throttled_until = NULL, "
            "                              first_event_at = NULL, last_event_at = NULL, "
            "                              updated_at = CURRENT_TIMESTAMP "
            " WHERE host = ?",
            (host,),
        )
        updated = cur.rowcount
    return {"host": host, "updated": updated}


@app.post("/admin/test/run-loop-tick")
async def admin_run_loop_tick():
    """Phase 4: force one autonomous-loop iteration (smoke-test affordance)."""
    eligible = _list_eligible_buckets()
    if not eligible:
        return {"action": "skip", "reason": "no_eligible_buckets"}
    results = await asyncio.gather(
        *[_loop_tick_for_bucket(b) for b in eligible],
        return_exceptions=True,
    )
    flat: list[dict[str, Any]] = []
    for r in results:
        if isinstance(r, Exception):
            continue
        if isinstance(r, list):
            flat.extend(x for x in r if isinstance(x, dict))
        elif isinstance(r, dict):
            flat.append(r)
    claims = sum(1 for x in flat if x.get("action") == "claim")
    return {"results": [str(r) if isinstance(r, Exception) else r for r in results],
            "claims": claims,
            "flat": flat,
            "eligible": eligible}


@app.get("/")
def root():
    return {
        "service":  SERVICE_NAME,
        "version":  VERSION,
        "phase":    4,
        "endpoints": [
            "/health", "/healthz", "/version",
            "/slots", "/slots/{bucket}",
            "/claim", "/release", "/heartbeat",
            "/spawn-task", "/spawn-telemetry",
            "/spawn-budget", "/spawn-budget/history",
            "/spawn-retry-budget", "/spawn-lineage/{spawn_id}",
            "/capacity", "/capacity/history",
            "/admin/host/register", "/admin/host/heartbeat",
            "/admin/hosts", "/admin/host/{name}", "/admin/host/{name}/state",
            "/admin/spawn-completion",
            "/admin/spawn-dead-letter", "/admin/spawn-dead-letter/{id}/replay",
            "/admin/autonomy", "/admin/autonomy/{bucket}", "/admin/autonomy/global",
            "/admin/loop/enable", "/admin/loop/disable", "/admin/loop/status", "/admin/loop/changes",
            "/metrics", "/metrics.json",
            "/webhooks/completion",
            "/admin/test/expire-heartbeat",
            "/admin/test/expire-lease",
            "/admin/test/expire-host",
            "/admin/test/set-lease",
            "/admin/test/set-budget-tokens",
            "/admin/test/set-slot-host",
            "/admin/test/clear-host-throttle",
            "/admin/test/run-watchdog",
            "/admin/test/run-loop-tick",
        ],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("slot_manager:app", host="0.0.0.0", port=SERVICE_PORT, log_level=LOG_LEVEL.lower(), access_log=True)
