"""
SPS — Smart Parallelism Scheduler — Phase 2
============================================

Adds, on top of the Phase 1 service:

  1. Observability — Prometheus /metrics endpoint exposing per-bucket queue
     depth, in-flight count, success/failure rate, p50/p95 spawn latency.
  2. Retries — failed spawns retry with exponential backoff (max 3 attempts).
     Each attempt logged in spawn_attempts table.
  3. Dead-letter queue — after max retries, task moves to dead_letter table
     with reason. Admin endpoint /dead-letter?bucket=X for inspection.
  4. Stuck-audit — /admin/audit/stuck-tasks finds in_progress tasks with
     last_heartbeat > 10 min ago and moves them to status='stuck'. Driven by
     a K8s CronJob every 5 min.
  5. Daily backup — driven by K8s CronJob (snapshot only; no app code).
  6. Bucket aliasing — bucket_aliases table; /spawn and /next-spawn resolve
     short aliases (M1 → M1-cowork, stolution → first available stolution-*)
     before bucket lookup.
  7. Parser hardening — backlog parser logs per-line errors and never crashes
     on malformed input. /reload returns parse_errors[].
  8. Phase 2 smoke tests — see smoke.sh in phase2/ artefacts.

Idempotent migrations run at startup; safe to re-deploy on top of Phase 1.
"""

import os
import re
import json
import time
import sqlite3
import math
import collections
from contextlib import contextmanager
from typing import Optional, List, Dict, Any, Tuple

from fastapi import FastAPI, HTTPException, Query, Response
from pydantic import BaseModel
import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_PATH       = os.environ.get("SPS_DB_PATH",     "/data/sps.db")
SCHEMA_PATH   = os.environ.get("SPS_SCHEMA_PATH", "/app/schema.sql")
PHASE         = os.environ.get("SPS_PHASE",       "2")
SLOT_MGR_URL  = os.environ.get("SPS_SLOT_MANAGER_URL",
                               "http://slot-manager.caia-orchestrator.svc.cluster.local:8081")
MEMORY_ROOT   = os.environ.get("SPS_MEMORY_ROOT", "/agent-memory")
DEFAULT_CAP   = int(os.environ.get("SPS_DEFAULT_CAP", "4"))
STUCK_AGE_MIN = int(os.environ.get("SPS_STUCK_AGE_MIN", "10"))
RETRY_BACKOFF = [
    int(os.environ.get("SPS_RETRY_BACKOFF_1_S", "30")),
    int(os.environ.get("SPS_RETRY_BACKOFF_2_S", "120")),
    int(os.environ.get("SPS_RETRY_BACKOFF_3_S", "600")),
]
MAX_RETRIES   = int(os.environ.get("SPS_MAX_RETRIES", "3"))
VERSION       = "0.3.0-phase2"

# In-memory ring buffer for spawn-latency p50/p95 (Phase 2 observability).
# Each entry is the elapsed milliseconds between /spawn (or /next-spawn)
# request arrival and the moment the claim row was committed.
_SPAWN_LATENCY_RING: collections.deque = collections.deque(maxlen=512)

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA foreign_keys=ON")
    c.row_factory = sqlite3.Row
    try:
        yield c
    finally:
        c.close()


def _has_column(c: sqlite3.Connection, table: str, col: str) -> bool:
    # SQLite is case-insensitive for identifiers; compare lowercased to be safe.
    return any(row[1].lower() == col.lower() for row in c.execute(f"PRAGMA table_info({table})"))


def _ensure_phase1_schema(c: sqlite3.Connection) -> None:
    """Re-applied for safety on Phase 2 startup (idempotent)."""
    if not _has_column(c, "nodes", "repo_scope"):
        c.execute("ALTER TABLE nodes ADD COLUMN repo_scope TEXT")
    if not _has_column(c, "nodes", "prompt_material"):
        c.execute("ALTER TABLE nodes ADD COLUMN prompt_material TEXT")
    if not _has_column(c, "nodes", "scope_tag"):
        c.execute("ALTER TABLE nodes ADD COLUMN scope_tag TEXT")
    if not _has_column(c, "nodes", "blockedBy_raw"):
        c.execute("ALTER TABLE nodes ADD COLUMN blockedBy_raw TEXT")
    c.execute("""
        CREATE TABLE IF NOT EXISTS cap_changes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            bucket     TEXT NOT NULL,
            old_cap    INTEGER NOT NULL,
            new_cap    INTEGER NOT NULL,
            changed_at TEXT NOT NULL DEFAULT (datetime('now')),
            changed_by TEXT NOT NULL DEFAULT 'unknown',
            reason     TEXT
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_cap_changes_bucket ON cap_changes(bucket)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_cap_changes_ts     ON cap_changes(changed_at)")
    c.commit()


def _ensure_phase2_schema(c: sqlite3.Connection) -> None:
    """Phase 2 additions: spawn_attempts, dead_letter, bucket_aliases, retry_at."""
    # retry_at + last_heartbeat_at on nodes
    if not _has_column(c, "nodes", "retry_at"):
        c.execute("ALTER TABLE nodes ADD COLUMN retry_at TEXT")
    if not _has_column(c, "nodes", "last_heartbeat_at"):
        c.execute("ALTER TABLE nodes ADD COLUMN last_heartbeat_at TEXT")

    # Spawn-attempt history (one row per try)
    c.execute("""
        CREATE TABLE IF NOT EXISTS spawn_attempts (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id       TEXT NOT NULL,
            attempt_num   INTEGER NOT NULL,
            bucket        TEXT,
            scheduled_at  TEXT NOT NULL DEFAULT (datetime('now')),
            outcome       TEXT,
            error         TEXT,
            duration_ms   INTEGER
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_spawn_attempts_node ON spawn_attempts(node_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_spawn_attempts_ts   ON spawn_attempts(scheduled_at)")

    # Dead-letter
    c.execute("""
        CREATE TABLE IF NOT EXISTS dead_letter (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id      TEXT NOT NULL,
            bucket       TEXT,
            scope_tag    TEXT,
            title        TEXT,
            attempts     INTEGER NOT NULL,
            reason       TEXT NOT NULL,
            payload      TEXT,
            moved_at     TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_dead_letter_bucket ON dead_letter(bucket)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_dead_letter_node   ON dead_letter(node_id)")

    # Bucket aliases
    c.execute("""
        CREATE TABLE IF NOT EXISTS bucket_aliases (
            alias        TEXT PRIMARY KEY,
            target       TEXT NOT NULL,
            note         TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    # Seed default aliases (idempotent)
    for alias, target, note in [
        ("M1",        "M1-cowork",        "default Phase-2 alias"),
        ("M3",        "M3-cowork",        "default Phase-2 alias"),
        ("stolution", "stolution-*",      "wildcard: first available stolution-* bucket"),
    ]:
        c.execute("""
            INSERT INTO bucket_aliases (alias, target, note)
            VALUES (?, ?, ?)
            ON CONFLICT(alias) DO NOTHING
        """, (alias, target, note))

    # Parse-error log (used by /reload hardening)
    c.execute("""
        CREATE TABLE IF NOT EXISTS parse_errors (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            source       TEXT NOT NULL,
            line_no      INTEGER,
            line_text    TEXT,
            error        TEXT NOT NULL,
            ts           TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    c.commit()


# ---------------------------------------------------------------------------
# Bucket alias resolution
# ---------------------------------------------------------------------------

def resolve_bucket(c: sqlite3.Connection, name: str) -> Tuple[str, Optional[str]]:
    """Return (resolved_bucket, alias_used).

    Resolution order:
      1. Exact match in `buckets` table → return as-is.
      2. Lookup in `bucket_aliases`. If target ends with `-*`, find the first
         enabled bucket whose name starts with the prefix and has free slots;
         if none have free slots, the lowest cap-1.
      3. Otherwise return (name, None) and let caller 404.
    """
    row = c.execute("SELECT bucket FROM buckets WHERE bucket = ?", (name,)).fetchone()
    if row:
        return name, None

    a = c.execute("SELECT target FROM bucket_aliases WHERE alias = ?", (name,)).fetchone()
    if not a:
        return name, None

    target = a["target"]
    if target.endswith("-*"):
        prefix = target[:-1]   # 'stolution-' from 'stolution-*'
        # Prefer buckets with free slots
        rows = c.execute("""
            SELECT b.bucket, b.cap, b.enabled,
                   (SELECT COUNT(*) FROM assignments a
                    WHERE a.bucket = b.bucket AND a.finished_at IS NULL) AS running
            FROM   buckets b
            WHERE  b.bucket LIKE ? AND b.enabled = 1
            ORDER  BY (b.cap - (SELECT COUNT(*) FROM assignments a
                                WHERE a.bucket = b.bucket AND a.finished_at IS NULL)) DESC,
                       b.bucket
        """, (prefix + "%",)).fetchall()
        for r in rows:
            if r["cap"] > r["running"]:
                return r["bucket"], name
        if rows:
            # All full → still pick first deterministically
            return rows[0]["bucket"], name
        return name, None
    else:
        # Direct alias → exact target
        return target, name


# ---------------------------------------------------------------------------
# DAG parser (hardened)
# ---------------------------------------------------------------------------

ROW_RE        = re.compile(r"^\|\s*([\d.]+(?:\.[\d.]+)?)\s*\|\s*\*\*([^|]+?)\*\*\s*(.*?)\|", re.M)
SCOPE_RE      = re.compile(r"\[scope:([1-3])\]")
ITEM_CODE_RE  = re.compile(r"^([A-Z]+\d+(?:\.[A-Z0-9]+)?)")
BUCKET_HINTS  = {
    "1": "M1-cowork",
    "2": "stolution-claude",
    "3": "stolution-build",
}


def parse_backlog(text: str, source: str = "inline") -> Dict[str, Any]:
    """Hardened parser. Returns {nodes, edges, parse_errors}.

    Each parse_errors entry is {line_no, line_text, error}. The parser never
    raises on malformed input — exceptions are captured and recorded.
    """
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []
    parse_errors: List[Dict[str, Any]] = []

    if not isinstance(text, str):
        parse_errors.append({"line_no": 0, "line_text": None,
                             "error": f"input not str: {type(text).__name__}"})
        return {"nodes": [], "edges": [], "parse_errors": parse_errors}

    lines = text.splitlines()
    for line_no, line in enumerate(lines, 1):
        try:
            m = ROW_RE.match(line)
            if not m:
                continue
            order, title_raw, rest = m.groups()
            title = (title_raw or "").strip()
            if not title:
                parse_errors.append({"line_no": line_no, "line_text": line[:200],
                                     "error": "empty title"})
                continue

            scope_match = SCOPE_RE.search(rest or "")
            scope = scope_match.group(1) if scope_match else "2"
            bucket = BUCKET_HINTS.get(scope, "stolution-claude")

            head = title.split("—")[0].strip() if "—" in title else title
            code_match = ITEM_CODE_RE.match(head)
            item_code = code_match.group(1) if code_match else f"row-{order}"
            nid = f"backlog::{item_code}"

            try:
                priority = int(float(order) * 10)
            except (TypeError, ValueError):
                priority = 100

            rest_lower = (rest or "").lower()
            if "in flight" in rest_lower or "in-flight" in rest_lower:
                status = "running"
            else:
                status = "pending"

            nodes[nid] = {
                "id":            nid,
                "parent_id":     None,
                "title":         title,
                "item_code":     item_code,
                "granularity":   "item",
                "status":        status,
                "target_bucket": bucket,
                "scope_tag":     scope,
                "priority":      priority,
                "estimate_min":  None,
                "repo_scope":    None,
                "file_scope":    None,
            }
        except Exception as exc:
            parse_errors.append({"line_no": line_no,
                                 "line_text": (line or "")[:200],
                                 "error": f"{type(exc).__name__}: {exc}"})
            continue

    try:
        ordered_ids = sorted(nodes.keys(), key=lambda k: nodes[k]["priority"])
        for i in range(1, len(ordered_ids)):
            edges.append({
                "from_id": ordered_ids[i - 1],
                "to_id":   ordered_ids[i],
                "reason":  "sequence",
                "soft":    1,
            })
    except Exception as exc:
        parse_errors.append({"line_no": 0, "line_text": None,
                             "error": f"edge-derivation: {type(exc).__name__}: {exc}"})

    return {"nodes": list(nodes.values()), "edges": edges,
            "parse_errors": parse_errors}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="SPS — Smart Parallelism Scheduler", version=VERSION)


@app.on_event("startup")
def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with conn() as c:
        with open(SCHEMA_PATH) as f:
            c.executescript(f.read())
        _ensure_phase1_schema(c)
        _ensure_phase2_schema(c)
        c.commit()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    try:
        with conn() as c:
            c.execute("SELECT 1").fetchone()
            buckets = c.execute("SELECT COUNT(*) FROM buckets WHERE enabled=1").fetchone()[0]
            running = c.execute("SELECT COUNT(*) FROM assignments WHERE finished_at IS NULL").fetchone()[0]
            n_nodes = c.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
            n_edges = c.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
            n_dlq   = c.execute("SELECT COUNT(*) FROM dead_letter").fetchone()[0]
            n_alias = c.execute("SELECT COUNT(*) FROM bucket_aliases").fetchone()[0]
        return {
            "status":          "ok",
            "sqlite_ok":       True,
            "phase":           PHASE,
            "buckets_enabled": buckets,
            "running_total":   running,
            "nodes":           n_nodes,
            "edges":           n_edges,
            "dead_letter":     n_dlq,
            "aliases":         n_alias,
            "version":         VERSION,
        }
    except Exception as e:
        raise HTTPException(503, f"degraded: {e}")


# ---------------------------------------------------------------------------
# /metrics — Prometheus text exposition
# ---------------------------------------------------------------------------

def _percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(s[int(k)])
    return float(s[f] + (s[c] - s[f]) * (k - f))


@app.get("/metrics")
def metrics():
    lines: List[str] = []
    lines.append("# HELP sps_info Build/version info")
    lines.append("# TYPE sps_info gauge")
    lines.append(f'sps_info{{version="{VERSION}",phase="{PHASE}"}} 1')

    with conn() as c:
        # Per-bucket state
        rows = c.execute("""
            SELECT b.bucket,
                   b.cap,
                   b.enabled,
                   (SELECT COUNT(*) FROM assignments a
                    WHERE a.bucket = b.bucket AND a.finished_at IS NULL) AS running,
                   (SELECT COUNT(*) FROM nodes n
                    WHERE n.target_bucket = b.bucket AND n.status = 'ready') AS ready_depth,
                   (SELECT COUNT(*) FROM nodes n
                    WHERE n.target_bucket = b.bucket AND n.status = 'pending') AS pending_depth,
                   (SELECT COUNT(*) FROM dead_letter d
                    WHERE d.bucket = b.bucket) AS dlq_depth,
                   (SELECT COUNT(*) FROM nodes n
                    WHERE n.target_bucket = b.bucket AND n.status = 'stuck') AS stuck_depth
            FROM   buckets b
        """).fetchall()

        lines += ["# HELP sps_bucket_cap Configured cap per bucket",
                  "# TYPE sps_bucket_cap gauge",
                  "# HELP sps_bucket_inflight Tasks currently in flight in this bucket",
                  "# TYPE sps_bucket_inflight gauge",
                  "# HELP sps_bucket_queue_depth Ready+pending tasks in this bucket",
                  "# TYPE sps_bucket_queue_depth gauge",
                  "# HELP sps_bucket_ready Ready tasks in this bucket",
                  "# TYPE sps_bucket_ready gauge",
                  "# HELP sps_bucket_dead_letter Dead-letter rows for this bucket",
                  "# TYPE sps_bucket_dead_letter gauge",
                  "# HELP sps_bucket_stuck Stuck tasks for this bucket",
                  "# TYPE sps_bucket_stuck gauge",
                  "# HELP sps_bucket_enabled 1 if bucket enabled, else 0",
                  "# TYPE sps_bucket_enabled gauge"]
        for r in rows:
            b = r["bucket"]
            lines.append(f'sps_bucket_cap{{bucket="{b}"}} {r["cap"]}')
            lines.append(f'sps_bucket_inflight{{bucket="{b}"}} {r["running"]}')
            lines.append(f'sps_bucket_queue_depth{{bucket="{b}"}} {(r["ready_depth"] or 0) + (r["pending_depth"] or 0)}')
            lines.append(f'sps_bucket_ready{{bucket="{b}"}} {r["ready_depth"] or 0}')
            lines.append(f'sps_bucket_dead_letter{{bucket="{b}"}} {r["dlq_depth"] or 0}')
            lines.append(f'sps_bucket_stuck{{bucket="{b}"}} {r["stuck_depth"] or 0}')
            lines.append(f'sps_bucket_enabled{{bucket="{b}"}} {1 if r["enabled"] else 0}')

        # Success / failure totals (from history)
        outcomes = c.execute("""
            SELECT COALESCE(bucket,'') AS bucket,
                   json_extract(payload,'$.outcome') AS outcome,
                   COUNT(*) AS n
            FROM   history
            WHERE  event = 'complete'
            GROUP  BY bucket, outcome
        """).fetchall()
        lines += ["# HELP sps_completion_total Completion events by bucket and outcome",
                  "# TYPE sps_completion_total counter"]
        for r in outcomes:
            outcome = r["outcome"] or "unknown"
            lines.append(f'sps_completion_total{{bucket="{r["bucket"]}",outcome="{outcome}"}} {r["n"]}')

        spawn_count = c.execute(
            "SELECT COUNT(*) FROM history WHERE event IN ('spawn','spawn-via-slot')"
        ).fetchone()[0]
        retry_count = c.execute("SELECT COUNT(*) FROM spawn_attempts").fetchone()[0]
        dlq_total   = c.execute("SELECT COUNT(*) FROM dead_letter").fetchone()[0]
        lines += ["# HELP sps_spawn_total Total spawn-claim events",
                  "# TYPE sps_spawn_total counter",
                  f"sps_spawn_total {spawn_count}",
                  "# HELP sps_retry_total Total spawn_attempts logged",
                  "# TYPE sps_retry_total counter",
                  f"sps_retry_total {retry_count}",
                  "# HELP sps_dead_letter_total Total dead-letter rows",
                  "# TYPE sps_dead_letter_total counter",
                  f"sps_dead_letter_total {dlq_total}"]

    # Spawn-latency p50/p95 from in-memory ring
    samples = list(_SPAWN_LATENCY_RING)
    p50 = _percentile(samples, 0.50)
    p95 = _percentile(samples, 0.95)
    lines += ["# HELP sps_spawn_latency_ms Spawn-claim latency in milliseconds (in-memory ring of 512)",
              "# TYPE sps_spawn_latency_ms summary",
              f'sps_spawn_latency_ms{{quantile="0.5"}} {p50:.3f}',
              f'sps_spawn_latency_ms{{quantile="0.95"}} {p95:.3f}',
              f"sps_spawn_latency_ms_count {len(samples)}"]

    body = "\n".join(lines) + "\n"
    return Response(content=body, media_type="text/plain; version=0.0.4")


# ---------------------------------------------------------------------------
# DAG inspect / reload
# ---------------------------------------------------------------------------

class ReloadBody(BaseModel):
    backlog_path: Optional[str] = None
    inline_text:  Optional[str] = None
    purge:        bool = False


@app.post("/reload")
def reload(body: ReloadBody):
    text = body.inline_text
    source = "inline"
    if not text and body.backlog_path:
        path = body.backlog_path
        source = body.backlog_path
        if not os.path.exists(path):
            path = os.path.join(MEMORY_ROOT, body.backlog_path)
        if not os.path.exists(path):
            raise HTTPException(404, f"backlog file not found: {body.backlog_path}")
        try:
            with open(path) as f:
                text = f.read()
        except Exception as e:
            raise HTTPException(500, f"backlog read failed: {e}")
    if not text:
        raise HTTPException(400, "must supply backlog_path or inline_text")

    parsed = parse_backlog(text, source=source)
    inserted_nodes = 0
    inserted_edges = 0
    with conn() as c:
        if body.purge:
            c.execute("DELETE FROM edges")
            c.execute("DELETE FROM nodes WHERE id LIKE 'backlog::%' OR id LIKE 'memory::%'")

        for n in parsed["nodes"]:
            try:
                c.execute("""
                    INSERT INTO nodes (id, parent_id, title, item_code, granularity,
                                       status, target_bucket, scope_tag, priority,
                                       repo_scope, file_scope)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title         = excluded.title,
                        target_bucket = excluded.target_bucket,
                        scope_tag     = excluded.scope_tag,
                        priority      = excluded.priority,
                        updated_at    = datetime('now')
                """, (n["id"], n["parent_id"], n["title"], n["item_code"], n["granularity"],
                      n["status"], n["target_bucket"], n["scope_tag"], n["priority"],
                      n.get("repo_scope"), n.get("file_scope")))
                inserted_nodes += 1
            except sqlite3.IntegrityError as e:
                parsed["parse_errors"].append({
                    "line_no": 0, "line_text": n.get("id"),
                    "error": f"insert: {e}",
                })

        for e in parsed["edges"]:
            try:
                c.execute("""
                    INSERT INTO edges (from_id, to_id, reason, soft)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(from_id, to_id, reason) DO NOTHING
                """, (e["from_id"], e["to_id"], e["reason"], int(e["soft"])))
                inserted_edges += 1
            except sqlite3.IntegrityError as exc:
                parsed["parse_errors"].append({
                    "line_no": 0, "line_text": f"{e['from_id']}->{e['to_id']}",
                    "error": f"insert-edge: {exc}",
                })

        # Persist parse errors for ops triage
        for pe in parsed["parse_errors"]:
            c.execute("""
                INSERT INTO parse_errors (source, line_no, line_text, error)
                VALUES (?, ?, ?, ?)
            """, (source, pe.get("line_no"), pe.get("line_text"), pe.get("error")))

        # Mark roots ready
        c.execute("""
            UPDATE nodes SET status = 'ready'
            WHERE status = 'pending'
              AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_id = nodes.id)
        """)

        c.execute("INSERT INTO history (event, payload) VALUES (?, ?)",
                  ("reload", json.dumps({
                      "inserted_nodes": inserted_nodes,
                      "inserted_edges": inserted_edges,
                      "parse_errors":   len(parsed["parse_errors"]),
                      "purge":          body.purge,
                      "source":         source,
                  })))
        c.commit()

    return {
        "ok":               True,
        "inserted_nodes":   inserted_nodes,
        "inserted_edges":   inserted_edges,
        "parse_errors":     parsed["parse_errors"],
        "parse_error_count": len(parsed["parse_errors"]),
        "purge":            body.purge,
    }


@app.get("/dag")
def dag():
    with conn() as c:
        nodes   = [dict(r) for r in c.execute("SELECT * FROM nodes")]
        edges   = [dict(r) for r in c.execute("SELECT * FROM edges")]
        buckets = [dict(r) for r in c.execute("SELECT * FROM bucket_load")]
    return {"nodes": nodes, "edges": edges, "buckets": buckets,
            "n_nodes": len(nodes), "n_edges": len(edges), "n_buckets": len(buckets)}


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

def _conflicts_with_running(c: sqlite3.Connection, node: sqlite3.Row) -> Optional[str]:
    if node["repo_scope"] and node["file_scope"]:
        running = c.execute("""
            SELECT n.id, n.repo_scope, n.file_scope, n.package_scope
            FROM   nodes n
            JOIN   assignments a ON a.node_id = n.id
            WHERE  a.finished_at IS NULL
        """).fetchall()
        my_files = set((node["file_scope"] or "").split(","))
        for r in running:
            if r["repo_scope"] != node["repo_scope"]:
                continue
            their_files = set((r["file_scope"] or "").split(","))
            overlap = (my_files & their_files) - {""}
            if overlap:
                return f"file-collision:{r['id']}:{','.join(sorted(overlap))}"

    if node["package_scope"]:
        clash = c.execute("""
            SELECT n.id FROM nodes n
            JOIN   assignments a ON a.node_id = n.id
            WHERE  a.finished_at IS NULL AND n.package_scope = ?
            LIMIT 1
        """, (node["package_scope"],)).fetchone()
        if clash:
            return f"package-collision:{clash['id']}"

    bad = c.execute("""
        SELECT p.id FROM edges e
        JOIN   nodes p ON p.id = e.from_id
        WHERE  e.to_id = ?
          AND  e.soft = 0
          AND  p.status NOT IN ('done','skipped')
    """, (node["id"],)).fetchone()
    if bad:
        return f"unmet-hard-dep:{bad['id']}"

    return None


def _ready_candidates_sql(scope: Optional[str]) -> Tuple[str, List[Any]]:
    """SQL that picks ready+claimable candidates honouring retry_at.

    Note: ready_nodes view already filters by status='ready'; we add the
    retry_at gate here.
    """
    sql = ("SELECT * FROM ready_nodes "
           "WHERE (target_bucket = ? OR target_bucket IS NULL) "
           "AND  (retry_at IS NULL OR retry_at <= datetime('now')) ")
    args: List[Any] = []
    if scope:
        sql += " AND (scope_tag = ? OR scope_tag IS NULL) "
    sql += " ORDER BY priority LIMIT 32"
    return sql, args


# ---------------------------------------------------------------------------
# /next-spawn
# ---------------------------------------------------------------------------

@app.get("/next-spawn")
def next_spawn(bucket: str = Query(...),
               scope:  Optional[str] = Query(None),
               slot_index: int = 0,
               dry_run: bool = False):
    started_ms = time.time() * 1000.0
    with conn() as c:
        resolved, alias_used = resolve_bucket(c, bucket)
        b = c.execute("SELECT cap, enabled FROM buckets WHERE bucket = ?",
                      (resolved,)).fetchone()
        if not b:
            return Response(status_code=204, headers={"X-SPS-Why": "bucket-unknown",
                                                       "X-SPS-Resolved": resolved})
        if not b["enabled"]:
            return Response(status_code=204, headers={"X-SPS-Why": "bucket-disabled",
                                                       "X-SPS-Resolved": resolved})

        running = c.execute(
            "SELECT COUNT(*) FROM assignments WHERE bucket = ? AND finished_at IS NULL",
            (resolved,)
        ).fetchone()[0]
        if running >= b["cap"]:
            return Response(status_code=204, headers={"X-SPS-Why": "bucket-full",
                                                       "X-SPS-Resolved": resolved})

        sql, _ = _ready_candidates_sql(scope)
        args: List[Any] = [resolved]
        if scope:
            args.append(scope)

        skipped: List[Dict[str, str]] = []
        for cand in c.execute(sql, args):
            why = _conflicts_with_running(c, cand)
            if why is None:
                if dry_run:
                    return {**dict(cand), "candidate": True,
                            "resolved_bucket": resolved, "alias_used": alias_used}
                c.execute("UPDATE nodes SET status='assigned', updated_at=datetime('now'), "
                          "last_heartbeat_at=datetime('now') WHERE id=?",
                          (cand["id"],))
                c.execute("INSERT INTO assignments (node_id, bucket, slot_index) VALUES (?,?,?)",
                          (cand["id"], resolved, slot_index))
                # spawn_attempts row
                attempt_num = (cand["retries"] or 0) + 1
                c.execute("""
                    INSERT INTO spawn_attempts (node_id, attempt_num, bucket, outcome, duration_ms)
                    VALUES (?, ?, ?, 'claimed', ?)
                """, (cand["id"], attempt_num, resolved,
                      int(time.time() * 1000.0 - started_ms)))
                c.execute("INSERT INTO history (event, node_id, bucket, payload) VALUES (?,?,?,?)",
                          ("spawn", cand["id"], resolved,
                           json.dumps({"slot": slot_index, "alias": alias_used,
                                       "attempt": attempt_num})))
                c.commit()
                _SPAWN_LATENCY_RING.append(time.time() * 1000.0 - started_ms)
                return {**dict(cand), "slot_index": slot_index,
                        "resolved_bucket": resolved, "alias_used": alias_used}
            else:
                skipped.append({"id": cand["id"], "why": why})
        return Response(status_code=204, headers={
            "X-SPS-Why":      "no-ready-work-passing-conflict-checks",
            "X-SPS-Resolved": resolved,
            "X-SPS-Skipped":  json.dumps(skipped)[:512],
        })


# ---------------------------------------------------------------------------
# /spawn — slot-manager callback
# ---------------------------------------------------------------------------

class SpawnBody(BaseModel):
    bucket:  str
    slot_id: str
    scope:   Optional[str] = None


def _load_prompt_material(node: sqlite3.Row) -> Dict[str, Any]:
    refs = [
        "~/Documents/projects/agent-memory/feedback_24_7_bulletproof_2026-05-08.md",
        "~/Documents/projects/agent-memory/master_backlog_sequencing_2026-05-05.md",
        "~/Documents/projects/agent-memory/sps_phase2_live_2026-05-09.md",
    ]
    return {
        "must_read_first": refs,
        "scope_tag":       node["scope_tag"],
        "bucket":          node["target_bucket"],
        "item_code":       node["item_code"],
    }


@app.post("/spawn")
def spawn(body: SpawnBody):
    started_ms = time.time() * 1000.0
    with conn() as c:
        resolved, alias_used = resolve_bucket(c, body.bucket)
        b = c.execute("SELECT cap, enabled FROM buckets WHERE bucket = ?",
                      (resolved,)).fetchone()
        if not b:
            raise HTTPException(404, f"bucket-unknown: {body.bucket} (resolved: {resolved})")
        if not b["enabled"]:
            return Response(status_code=204, headers={"X-SPS-Why": "bucket-disabled",
                                                       "X-SPS-Resolved": resolved})

        running = c.execute(
            "SELECT COUNT(*) FROM assignments WHERE bucket = ? AND finished_at IS NULL",
            (resolved,)
        ).fetchone()[0]
        if running >= b["cap"]:
            return Response(status_code=204, headers={"X-SPS-Why": "bucket-full",
                                                       "X-SPS-Resolved": resolved})

        sql, _ = _ready_candidates_sql(body.scope)
        args: List[Any] = [resolved]
        if body.scope:
            args.append(body.scope)

        for cand in c.execute(sql, args):
            why = _conflicts_with_running(c, cand)
            if why is not None:
                continue
            c.execute("UPDATE nodes SET status='assigned', updated_at=datetime('now'), "
                      "last_heartbeat_at=datetime('now') WHERE id=?",
                      (cand["id"],))
            c.execute("""
                INSERT INTO assignments (node_id, bucket, slot_index, spawn_payload)
                VALUES (?, ?, ?, ?)
            """, (cand["id"], resolved, 0, body.slot_id))
            attempt_num = (cand["retries"] or 0) + 1
            c.execute("""
                INSERT INTO spawn_attempts (node_id, attempt_num, bucket, outcome, duration_ms)
                VALUES (?, ?, ?, 'claimed', ?)
            """, (cand["id"], attempt_num, resolved,
                  int(time.time() * 1000.0 - started_ms)))
            c.execute("INSERT INTO history (event, node_id, bucket, payload) VALUES (?,?,?,?)",
                      ("spawn-via-slot", cand["id"], resolved,
                       json.dumps({"slot_id": body.slot_id, "alias": alias_used,
                                   "attempt": attempt_num})))
            c.commit()
            _SPAWN_LATENCY_RING.append(time.time() * 1000.0 - started_ms)
            spec = dict(cand)
            spec["slot_id"] = body.slot_id
            spec["resolved_bucket"] = resolved
            spec["alias_used"] = alias_used
            spec["prompt_material"] = _load_prompt_material(cand)
            return spec

        return Response(status_code=204, headers={"X-SPS-Why": "no-ready-work",
                                                   "X-SPS-Resolved": resolved})


# ---------------------------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------------------------

class HeartbeatBody(BaseModel):
    node_id: str
    bucket:  str
    alive_signal: bool = True
    tool_calls_since_last: Optional[int] = None
    tokens_used_session:   Optional[int] = None
    current_subtask:       Optional[str] = None


@app.post("/heartbeat")
def heartbeat(body: HeartbeatBody):
    with conn() as c:
        cur = c.execute(
            "UPDATE assignments SET last_seen_at = datetime('now') "
            "WHERE node_id = ? AND finished_at IS NULL",
            (body.node_id,)
        )
        c.execute(
            "UPDATE nodes SET last_heartbeat_at = datetime('now') WHERE id = ?",
            (body.node_id,)
        )
        c.execute(
            "INSERT INTO history (event, node_id, bucket, payload) VALUES (?, ?, ?, ?)",
            ("heartbeat", body.node_id, body.bucket,
             json.dumps({"subtask": body.current_subtask, "matched": cur.rowcount}))
        )
        c.commit()
    return {"acked": True, "directive": "continue"}


# ---------------------------------------------------------------------------
# Completion — Phase 2 retry + dead-letter logic
# ---------------------------------------------------------------------------

class CompletionBody(BaseModel):
    node_id: str
    bucket:  str
    outcome: str
    outcome_detail:     Optional[str] = None
    duration_min_actual: Optional[int] = None
    artefact_paths:     Optional[List[str]] = None
    files_touched:      Optional[List[str]] = None


@app.post("/completion")
def completion(body: CompletionBody):
    with conn() as c:
        # Close any open assignment row
        c.execute(
            "UPDATE assignments SET finished_at = datetime('now'), outcome = ? "
            "WHERE node_id = ? AND finished_at IS NULL",
            (body.outcome, body.node_id)
        )
        node = c.execute("SELECT * FROM nodes WHERE id = ?", (body.node_id,)).fetchone()
        if node is None:
            raise HTTPException(404, f"node-unknown: {body.node_id}")

        if body.outcome == "failed":
            attempts = (node["retries"] or 0) + 1
            max_r    = node["max_retries"] if node["max_retries"] is not None else MAX_RETRIES
            # Log this attempt
            c.execute("""
                INSERT INTO spawn_attempts (node_id, attempt_num, bucket, outcome, error)
                VALUES (?, ?, ?, 'failed', ?)
            """, (body.node_id, attempts, body.bucket, body.outcome_detail or ""))

            if attempts >= max_r:
                # Move to dead_letter
                c.execute("""
                    INSERT INTO dead_letter (node_id, bucket, scope_tag, title,
                                             attempts, reason, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (node["id"], body.bucket, node["scope_tag"], node["title"],
                      attempts, body.outcome_detail or "max-retries-exceeded",
                      json.dumps({"node": dict(node)}, default=str)))
                c.execute(
                    "UPDATE nodes SET status='failed', retries=?, updated_at=datetime('now') "
                    "WHERE id=?",
                    (attempts, body.node_id)
                )
                c.execute("INSERT INTO history (event, node_id, bucket, payload) VALUES (?,?,?,?)",
                          ("dead-letter", body.node_id, body.bucket,
                           json.dumps({"attempts": attempts,
                                       "reason": body.outcome_detail})))
            else:
                # Schedule retry with exponential backoff
                idx = min(attempts - 1, len(RETRY_BACKOFF) - 1)
                backoff_s = RETRY_BACKOFF[idx]
                c.execute(
                    "UPDATE nodes SET status='ready', retries=?, "
                    "retry_at = datetime('now', ?), updated_at = datetime('now') "
                    "WHERE id=?",
                    (attempts, f"+{backoff_s} seconds", body.node_id)
                )
                c.execute("INSERT INTO history (event, node_id, bucket, payload) VALUES (?,?,?,?)",
                          ("retry-scheduled", body.node_id, body.bucket,
                           json.dumps({"attempts": attempts, "backoff_s": backoff_s,
                                       "reason": body.outcome_detail})))
        else:
            target_status = {"done": "done", "partial": "stuck",
                             "cancelled": "skipped"}.get(body.outcome, "done")
            c.execute("UPDATE nodes SET status = ?, updated_at = datetime('now') WHERE id = ?",
                      (target_status, body.node_id))
            c.execute("INSERT INTO history (event, node_id, bucket, payload) VALUES (?, ?, ?, ?)",
                      ("complete", body.node_id, body.bucket,
                       json.dumps({"outcome": body.outcome,
                                   "detail": body.outcome_detail})))

        # Cascade ready-marks
        c.execute("""
            UPDATE nodes SET status = 'ready'
            WHERE status = 'pending'
              AND id IN (
                SELECT to_id FROM edges
                GROUP BY to_id
                HAVING SUM(CASE WHEN
                    (SELECT status FROM nodes WHERE id = from_id) IN ('done','skipped')
                    THEN 0 ELSE 1 END) = 0
              )
        """)
        c.commit()
        unlocked = [r["id"] for r in c.execute(
            "SELECT id FROM nodes WHERE status = 'ready' AND id IN "
            "(SELECT to_id FROM edges WHERE from_id = ?)", (body.node_id,)
        )]
    return {"acked": True, "next_unlocked": unlocked, "outcome": body.outcome}


# ---------------------------------------------------------------------------
# /cap — admin
# ---------------------------------------------------------------------------

@app.post("/cap")
def cap(bucket: str = Query(...),
        value:  int = Query(...),
        reason: Optional[str] = Query(None),
        actor:  Optional[str] = Query(None)):
    if value < 0 or value > 64:
        raise HTTPException(400, "value out of range [0,64]")
    with conn() as c:
        resolved, _ = resolve_bucket(c, bucket)
        row = c.execute("SELECT cap FROM buckets WHERE bucket = ?",
                        (resolved,)).fetchone()
        if not row:
            raise HTTPException(404, f"bucket-unknown: {bucket}")
        old = row["cap"]
        if old == value:
            return {"ok": True, "no_change": True, "bucket": resolved, "cap": old}
        c.execute("UPDATE buckets SET cap=?, updated_at=datetime('now') WHERE bucket=?",
                  (value, resolved))
        c.execute("""
            INSERT INTO cap_changes (bucket, old_cap, new_cap, changed_by, reason)
            VALUES (?, ?, ?, ?, ?)
        """, (resolved, old, value, actor or "operator", reason))
        c.execute("INSERT INTO history (event, bucket, payload) VALUES (?,?,?)",
                  ("cap-change", resolved,
                   json.dumps({"old": old, "new": value, "by": actor})))
        c.commit()
    return {"ok": True, "bucket": resolved, "old_cap": old, "new_cap": value}


@app.get("/cap/history")
def cap_history(bucket: Optional[str] = Query(None), limit: int = 100):
    with conn() as c:
        if bucket:
            resolved, _ = resolve_bucket(c, bucket)
            rows = c.execute(
                "SELECT * FROM cap_changes WHERE bucket = ? ORDER BY id DESC LIMIT ?",
                (resolved, limit)
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM cap_changes ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
    return {"changes": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# Dead-letter inspection
# ---------------------------------------------------------------------------

@app.get("/dead-letter")
def dead_letter(bucket: Optional[str] = Query(None), limit: int = 100):
    with conn() as c:
        if bucket:
            resolved, _ = resolve_bucket(c, bucket)
            rows = c.execute(
                "SELECT * FROM dead_letter WHERE bucket = ? ORDER BY id DESC LIMIT ?",
                (resolved, limit)
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM dead_letter ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        n_total = c.execute("SELECT COUNT(*) FROM dead_letter").fetchone()[0]
    return {"items": [dict(r) for r in rows], "count": len(rows),
            "total": n_total, "bucket": bucket}


class DLQRequeueBody(BaseModel):
    node_id: str
    reset_retries: bool = True


@app.post("/dead-letter/requeue")
def dead_letter_requeue(body: DLQRequeueBody):
    """Take a dead-letter row back into the live DAG (status=ready, attempts reset)."""
    with conn() as c:
        dlq = c.execute("SELECT * FROM dead_letter WHERE node_id = ? ORDER BY id DESC LIMIT 1",
                        (body.node_id,)).fetchone()
        if not dlq:
            raise HTTPException(404, f"dead-letter row not found: {body.node_id}")
        new_retries = 0 if body.reset_retries else None
        if new_retries is None:
            c.execute("UPDATE nodes SET status='ready', retry_at=NULL, "
                      "updated_at=datetime('now') WHERE id=?", (body.node_id,))
        else:
            c.execute("UPDATE nodes SET status='ready', retries=?, retry_at=NULL, "
                      "updated_at=datetime('now') WHERE id=?",
                      (new_retries, body.node_id))
        c.execute("DELETE FROM dead_letter WHERE id=?", (dlq["id"],))
        c.execute("INSERT INTO history (event, node_id, bucket, payload) VALUES (?,?,?,?)",
                  ("dlq-requeue", body.node_id, dlq["bucket"],
                   json.dumps({"reset_retries": body.reset_retries})))
        c.commit()
    return {"ok": True, "requeued": body.node_id}


# ---------------------------------------------------------------------------
# Bucket aliases — admin
# ---------------------------------------------------------------------------

class AliasBody(BaseModel):
    alias:  str
    target: str
    note:   Optional[str] = None


@app.get("/aliases")
def aliases_list():
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM bucket_aliases ORDER BY alias")]
    return {"aliases": rows, "count": len(rows)}


@app.post("/aliases")
def aliases_upsert(body: AliasBody):
    with conn() as c:
        c.execute("""
            INSERT INTO bucket_aliases (alias, target, note)
            VALUES (?, ?, ?)
            ON CONFLICT(alias) DO UPDATE SET
                target = excluded.target,
                note   = excluded.note
        """, (body.alias, body.target, body.note))
        c.commit()
    return {"ok": True, "alias": body.alias, "target": body.target}


@app.delete("/aliases/{alias}")
def aliases_delete(alias: str):
    with conn() as c:
        cur = c.execute("DELETE FROM bucket_aliases WHERE alias = ?", (alias,))
        c.commit()
    return {"ok": True, "removed": cur.rowcount}


@app.get("/resolve")
def resolve_endpoint(bucket: str = Query(...)):
    """Diagnostic: shows what `bucket` would resolve to."""
    with conn() as c:
        resolved, alias_used = resolve_bucket(c, bucket)
        exists = c.execute("SELECT 1 FROM buckets WHERE bucket = ?",
                           (resolved,)).fetchone() is not None
    return {"input": bucket, "resolved": resolved,
            "alias_used": alias_used, "exists": exists}


# ---------------------------------------------------------------------------
# Bucket admin
# ---------------------------------------------------------------------------

class BucketAdminBody(BaseModel):
    cap:     Optional[int]  = None
    enabled: Optional[bool] = None
    notes:   Optional[str]  = None


@app.post("/admin/bucket/{bucket}")
def admin_bucket(bucket: str, body: BucketAdminBody):
    with conn() as c:
        resolved, _ = resolve_bucket(c, bucket)
        existing = c.execute("SELECT * FROM buckets WHERE bucket = ?",
                             (resolved,)).fetchone()
        if not existing:
            raise HTTPException(404, f"bucket-not-found: {bucket}")
        sets, args = [], []
        if body.cap is not None:
            sets.append("cap = ?"); args.append(body.cap)
            c.execute("""
                INSERT INTO cap_changes (bucket, old_cap, new_cap, changed_by, reason)
                VALUES (?, ?, ?, 'admin/bucket', 'via /admin/bucket')
            """, (resolved, existing["cap"], body.cap))
        if body.enabled is not None:
            sets.append("enabled = ?"); args.append(1 if body.enabled else 0)
        if body.notes is not None:
            sets.append("notes = ?"); args.append(body.notes)
        if sets:
            sets.append("updated_at = datetime('now')")
            args.append(resolved)
            c.execute(f"UPDATE buckets SET {', '.join(sets)} WHERE bucket = ?", args)
        c.execute("INSERT INTO history (event, bucket, payload) VALUES (?, ?, ?)",
                  ("admin-bucket", resolved, json.dumps(body.model_dump())))
        c.commit()
        return dict(c.execute("SELECT * FROM buckets WHERE bucket = ?",
                              (resolved,)).fetchone())


# ---------------------------------------------------------------------------
# Stuck audits
# ---------------------------------------------------------------------------

class StuckAuditBody(BaseModel):
    max_age_min: int = STUCK_AGE_MIN
    move_to_stuck: bool = False


@app.post("/admin/audit/stuck-assignments")
def stuck_audit(body: StuckAuditBody):
    """Phase 1-compatible stuck-assignment scan (read-only by default)."""
    with conn() as c:
        stuck = [dict(r) for r in c.execute(
            "SELECT id, node_id, bucket, last_seen_at FROM assignments "
            "WHERE finished_at IS NULL "
            "AND (julianday('now') - julianday(last_seen_at)) * 24 * 60 > ?",
            (body.max_age_min,)
        )]
        c.execute("INSERT INTO history (event, payload) VALUES (?, ?)",
                  ("stuck-audit", json.dumps({"max_age_min": body.max_age_min,
                                              "count": len(stuck)})))
        c.commit()
    return {"acked": True, "stuck_count": len(stuck), "stuck": stuck, "phase": PHASE}


@app.post("/admin/audit/stuck-tasks")
def stuck_tasks(body: StuckAuditBody):
    """Phase 2: find in_progress (status='running' or 'assigned') tasks whose
    last_heartbeat_at is older than max_age_min, mark them status='stuck'.

    The CronJob hits this every 5 minutes with move_to_stuck=true.
    """
    with conn() as c:
        # Use last_heartbeat_at if set; otherwise fall back to assignments.last_seen_at
        candidates = c.execute(
            """
            SELECT n.id, n.title, n.target_bucket, n.status,
                   COALESCE(n.last_heartbeat_at, a.last_seen_at) AS hb,
                   a.id AS assn_id
            FROM   nodes n
            LEFT   JOIN assignments a ON a.node_id = n.id AND a.finished_at IS NULL
            WHERE  n.status IN ('assigned','running')
              AND  COALESCE(n.last_heartbeat_at, a.last_seen_at) IS NOT NULL
              AND  (julianday('now') - julianday(
                       COALESCE(n.last_heartbeat_at, a.last_seen_at))) * 24 * 60 > ?
            """,
            (body.max_age_min,)
        ).fetchall()
        stuck_rows = [dict(r) for r in candidates]
        moved = 0
        if body.move_to_stuck and stuck_rows:
            for r in stuck_rows:
                c.execute("UPDATE nodes SET status='stuck', updated_at=datetime('now') "
                          "WHERE id=?", (r["id"],))
                if r.get("assn_id"):
                    c.execute("UPDATE assignments SET finished_at=datetime('now'), "
                              "outcome='stuck' WHERE id=?", (r["assn_id"],))
                c.execute("INSERT INTO history (event, node_id, bucket, payload) VALUES (?,?,?,?)",
                          ("stuck-marked", r["id"], r["target_bucket"],
                           json.dumps({"hb": r["hb"], "max_age_min": body.max_age_min})))
                moved += 1
            c.commit()
        c.execute("INSERT INTO history (event, payload) VALUES (?, ?)",
                  ("stuck-tasks-audit",
                   json.dumps({"max_age_min": body.max_age_min,
                               "found": len(stuck_rows),
                               "moved": moved})))
        c.commit()
    return {"acked": True, "found": len(stuck_rows), "moved": moved,
            "stuck": stuck_rows, "phase": PHASE}


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------

class TestSeedBody(BaseModel):
    confirm: bool = False


@app.post("/admin/test/seed-3node-dag")
def seed_3node(body: TestSeedBody):
    if not body.confirm:
        raise HTTPException(400, "must set confirm=true")
    with conn() as c:
        nodes = [
            ("test::A", "fake-A-root",       100),
            ("test::B", "fake-B-child-of-A", 110),
            ("test::C", "fake-C-child-of-A", 120),
            ("test::D", "fake-D-merge-B-C",  130),
        ]
        for nid, title, prio in nodes:
            c.execute("""
                INSERT INTO nodes (id, title, item_code, granularity, status,
                                   target_bucket, scope_tag, priority,
                                   retries, max_retries)
                VALUES (?, ?, ?, 'item', 'pending', 'M1-cowork', '1', ?, 0, 3)
                ON CONFLICT(id) DO UPDATE SET status='pending', retries=0, retry_at=NULL
            """, (nid, title, nid, prio))
        edges = [
            ("test::A", "test::B"),
            ("test::A", "test::C"),
            ("test::B", "test::D"),
            ("test::C", "test::D"),
        ]
        for f, t in edges:
            c.execute("""
                INSERT INTO edges (from_id, to_id, reason, soft)
                VALUES (?, ?, 'test', 0)
                ON CONFLICT(from_id, to_id, reason) DO NOTHING
            """, (f, t))
        c.execute("UPDATE nodes SET status='ready' WHERE id='test::A'")
        c.commit()
    return {"ok": True, "seeded_nodes": 4, "seeded_edges": 4}


class TestRetrySeedBody(BaseModel):
    confirm: bool = False
    node_id: str = "test::retry"
    max_retries: int = 2  # 1 normal + 1 retry then DLQ


@app.post("/admin/test/seed-retry-node")
def seed_retry(body: TestRetrySeedBody):
    """Seed a single ready node with low max_retries for the retry/DLQ smoke."""
    if not body.confirm:
        raise HTTPException(400, "must set confirm=true")
    with conn() as c:
        c.execute("""
            INSERT INTO nodes (id, title, item_code, granularity, status,
                               target_bucket, scope_tag, priority,
                               retries, max_retries)
            VALUES (?, 'fake-retry-node', ?, 'item', 'ready',
                    'M1-cowork', '1', 50, 0, ?)
            ON CONFLICT(id) DO UPDATE SET
                status='ready', retries=0, retry_at=NULL,
                max_retries=excluded.max_retries
        """, (body.node_id, body.node_id, body.max_retries))
        c.commit()
    return {"ok": True, "node_id": body.node_id,
            "max_retries": body.max_retries}


class TestStuckSeedBody(BaseModel):
    confirm: bool = False
    node_id: str = "test::stuck"
    age_min: int = 30


@app.post("/admin/test/seed-stuck-node")
def seed_stuck(body: TestStuckSeedBody):
    """Seed a node in 'assigned' state with last_heartbeat_at age_min ago."""
    if not body.confirm:
        raise HTTPException(400, "must set confirm=true")
    with conn() as c:
        c.execute("""
            INSERT INTO nodes (id, title, item_code, granularity, status,
                               target_bucket, scope_tag, priority,
                               last_heartbeat_at)
            VALUES (?, 'fake-stuck-node', ?, 'item', 'assigned',
                    'M1-cowork', '1', 50, datetime('now', ?))
            ON CONFLICT(id) DO UPDATE SET
                status='assigned',
                last_heartbeat_at=datetime('now', ?)
        """, (body.node_id, body.node_id,
              f"-{body.age_min} minutes", f"-{body.age_min} minutes"))
        c.execute("""
            INSERT INTO assignments (node_id, bucket, slot_index, last_seen_at)
            VALUES (?, 'M1-cowork', 0, datetime('now', ?))
        """, (body.node_id, f"-{body.age_min} minutes"))
        c.commit()
    return {"ok": True, "node_id": body.node_id, "age_min": body.age_min}


@app.post("/admin/test/clear")
def clear_test(body: TestSeedBody):
    if not body.confirm:
        raise HTTPException(400, "must set confirm=true")
    with conn() as c:
        c.execute("DELETE FROM assignments WHERE node_id LIKE 'test::%'")
        c.execute("DELETE FROM edges WHERE from_id LIKE 'test::%' OR to_id LIKE 'test::%'")
        c.execute("DELETE FROM dead_letter WHERE node_id LIKE 'test::%'")
        c.execute("DELETE FROM spawn_attempts WHERE node_id LIKE 'test::%'")
        c.execute("DELETE FROM nodes WHERE id LIKE 'test::%'")
        c.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {
        "service": "sps",
        "version": VERSION,
        "phase":   PHASE,
        "endpoints": [
            "/health", "/metrics",
            "/dag", "/reload",
            "/next-spawn", "/spawn",
            "/heartbeat", "/completion",
            "/cap", "/cap/history",
            "/dead-letter", "/dead-letter/requeue",
            "/aliases", "/resolve",
            "/admin/bucket/{bucket}",
            "/admin/audit/stuck-assignments",
            "/admin/audit/stuck-tasks",
            "/admin/test/seed-3node-dag",
            "/admin/test/seed-retry-node",
            "/admin/test/seed-stuck-node",
            "/admin/test/clear",
        ],
    }
