"""
claude-spawner-agent — Phase 5 (real-work mode + auto-PR)

Phase 5 deltas vs Phase 3
-------------------------
1. permission_mode parameter
   - The spawn payload may now carry `permission_mode` ∈
     {"plan","acceptEdits","bypassPermissions"}. Default: "plan" (preserves
     Phase 3 behaviour exactly — read-only, --max-turns 1).
   - "acceptEdits" → no max-turns cap, --permission-mode acceptEdits.
   - "bypassPermissions" → no max-turns cap, --permission-mode
     bypassPermissions. Reserved for highest-trust internal flows; never
     auto-promoted by slot-manager.

2. --add-dir allow-list pass-through
   - The spawn payload may carry `allow_list: list[str]`. Each path is
     validated against ALLOWED_ROOT (default: ~/Documents/projects) and a
     blocklist (no /etc, /var, /System, /usr, /Library, /boot). Surviving
     paths are passed verbatim as `--add-dir <path>` flags to the claude
     binary so the spawned agent can only write inside its bucket's
     declared scope. If any path fails validation, the spawn is rejected
     with outcome=`rejected_path_escape` (HTTP 451).

3. Auto-PR on completion
   - If `auto_pr: true` is in the payload AND the spawn returns ok AND
     commits exist on the spawn's working branch since spawn-start, the
     spawner:
       a. amends each new commit to ensure the `Spawned-By:
          caia-autonomous-loop` trailer is present (uses git filter to
          add the trailer non-destructively).
       b. pushes the branch to origin.
       c. opens a PR via `gh pr create --base develop --label autonomous`.
       d. if `risk_tier` ∈ {"low","medium"} AND `auto_merge: true`:
          enables `gh pr merge --auto --squash`. evidence-gate ("required
          checks all green") is enforced by GitHub's auto-merge
          machinery — it does not merge until checks pass.
       e. high-risk specs (`risk_tier == "high"`) NEVER get auto-merge,
          regardless of `auto_merge` flag.

4. Real-edit prompt builder
   - When permission_mode != "plan", the spawner emits a different prompt
     that instructs claude to actually do the work, commit with the
     mandatory footer, and stop.

5. Subscription guard preserved
   - All four layers (slot-manager startup + per-call, spawner startup +
     per-call) remain non-negotiable. ANTHROPIC_API_KEY is stripped from
     subprocess env regardless of permission_mode. Phase 5 only changes
     the EXECUTION permission, not the SPEND permission.

Authoring discharges agent-memory/slot_manager_phase5_brief.md (operator-
amended scope: permission_mode tri-state + allow_list pass-through +
auto-PR; M3/lineage/dashboard deferred to Phase 6).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import re
import shlex
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

# LAI phase 7: pre-spawn classify-and-maybe-route gate + optimizer pre-pass.
# Aliased `health` -> `router_health` because the spawner has its own
# /health FastAPI endpoint named `health` below.
from local_llm_router_client import (
    classify_and_maybe_route,
    health as router_health,
    optimize_prompt,
)
# SPS-Prompting phase α (A.9.3 + A.9.6): claude-argv builder.
# Vendored alongside local_llm_router_client.py as a standalone module so
# the py-client test suite can exercise the wrap/stabilize decision tree
# without dragging in fastapi/sqlite.
from spawner_argv import build_claude_argv as _build_claude_argv


# --- Configuration ---------------------------------------------------------

VERSION       = "1.2.0-phase6-worktree"
PORT          = int(os.environ.get("PORT", "8090"))
HOST_NAME     = os.environ.get("HOST_NAME", "mac-m1")
CLAUDE_BINARY = os.environ.get("CLAUDE_BINARY", "/Users/MAC/.local/bin/claude")

# LAI phase 7: local-llm-router gate + 3-stage prompt-optimizer pre-pass.
# Both gates are independent so operators can disable one without losing the
# other (e.g. keep optimizer on if classifier model gets flaky).
ROUTER_URL          = os.environ.get("LOCAL_LLM_ROUTER_URL", "http://100.68.247.58:7411")
ROUTER_GATE_ENABLED = os.environ.get("ROUTER_GATE_ENABLED", "true").lower() in ("1", "true", "yes")
OPTIMIZER_ENABLED   = os.environ.get("OPTIMIZER_ENABLED", "true").lower() in ("1", "true", "yes")
OPTIMIZER_TIMEOUT_S = float(os.environ.get("OPTIMIZER_TIMEOUT_S", "30.0"))

# SPS-Prompting phase α (A.9.3): headroom wrap on the claude binary call.
# Kill-switch HEADROOM_WRAP_DISABLE=1 bypasses the wrap. Also bypassed if
# HEADROOM_BINARY does not exist on disk (fail-open) — keeps stolution
# (no headroom yet) working without code-divergence from M-series boxes.
HEADROOM_BINARY        = os.environ.get("HEADROOM_BINARY", "/opt/homebrew/bin/headroom")
HEADROOM_WRAP_DISABLE  = os.environ.get("HEADROOM_WRAP_DISABLE", "").lower() in ("1", "true", "yes")
HEADROOM_PROXY_PORT    = int(os.environ.get("HEADROOM_PROXY_PORT", "8787"))
HEADROOM_PROXY_OFFSET  = int(os.environ.get("HEADROOM_PROXY_OFFSET", "0"))
# SPS-Prompting phase α (A.9.6): KV-cache prefix stabilization. Adds
# --exclude-dynamic-system-prompt-sections to the claude argv so per-host
# bits (cwd, env, memory paths, git status) move out of the cached system
# prefix. Precondition for Anthropic's 90% prompt-cache discount.
STABILIZE_PREFIX_DISABLE = os.environ.get("STABILIZE_PREFIX_DISABLE", "").lower() in ("1", "true", "yes")

LOG_LEVEL     = os.environ.get("LOG_LEVEL", "INFO").upper()
DB_PATH       = Path(os.environ.get(
    "SPAWNER_DB",
    str(Path.home() / ".cache/claude-spawner-agent/spawner.db")
))
DEFAULT_TIMEOUT_S = float(os.environ.get("DEFAULT_TIMEOUT_S", "1200.0"))  # Phase 6 fix: 20-min default; matches slot-manager SPAWN_TIMEOUT_SEC
SLOT_MANAGER_URL  = os.environ.get(
    "SLOT_MANAGER_URL",
    "http://10.43.173.170:8081"
)
SELF_SPAWNER_URL  = os.environ.get(
    "SELF_SPAWNER_URL",
    f"http://100.90.12.37:{PORT}"
)
AUTO_REGISTER     = os.environ.get("AUTO_REGISTER", "1") not in ("0", "false", "no")

# Phase 5: allowed roots and blocklist for --add-dir flags.
# Anything outside ALLOWED_ROOT or matching PATH_BLOCKLIST_RE is rejected.
ALLOWED_ROOT  = Path(os.environ.get(
    "ALLOWED_ROOT",
    str(Path.home() / "Documents" / "projects")
)).resolve()
PATH_BLOCKLIST_RE = re.compile(
    os.environ.get("PATH_BLOCKLIST_RE",
                   r"^/etc(/|$)|^/var(/|$)|^/System(/|$)|^/usr(/|$)|"
                   r"^/Library(/|$)|^/boot(/|$)|^/private/etc(/|$)|"
                   r"^/private/var(/|$)|^/private/tmp(/|$)")
)

# Phase 5: permission modes accepted from the dispatch payload.
VALID_PERMISSION_MODES = {"plan", "acceptEdits", "bypassPermissions"}
DEFAULT_PERMISSION_MODE = "plan"

# Phase 5: max-turns budget per mode. plan-mode keeps the old 1-turn cap;
# real-edit modes get a much larger budget (claude usually finishes well
# within this for low/medium-risk doc edits).
PERMISSION_MODE_MAX_TURNS = {
    "plan":              1,
    "acceptEdits":       None,   # unbounded — let timeout enforce
    "bypassPermissions": None,
}

# Phase 5: footer added to every autonomous commit.
SPAWNED_BY_TRAILER = "Spawned-By: caia-autonomous-loop"

# Phase 5: PR labels and base branch.
DEFAULT_PR_BASE_BRANCH = os.environ.get("DEFAULT_PR_BASE_BRANCH", "develop")
DEFAULT_PR_LABEL       = os.environ.get("DEFAULT_PR_LABEL", "autonomous")

# Phase 6: per-spawn git worktree isolation.
# When WORKTREE_PER_SPAWN is on (default), every real-edit spawn runs inside
# its own `<repo_root>/.spawn-worktrees/<task_id>-<short>` worktree, branched
# off WORKTREE_BASE_BRANCH (default `develop`, falls back to `master`/`main`/
# the local HEAD if the configured base ref is missing). The worktree is
# torn down on every outcome (ok, crashed, timeout, spawner_error) so disk
# leaks are bounded; stale worktrees > WORKTREE_STALE_HOURS old are pruned
# at spawner startup as a safety net for crashed workers.
#
# This unblocks cap > 1 per host: parallel spawns no longer share a working
# tree (which corrupted per-task audit and clobbered each other's `auto/`
# branch via the Phase-5 "reuse if already on auto/" path — bug #4 in
# agent-memory/mock_backlog_reliability_pass_2026-05-10.md).
WORKTREE_PER_SPAWN   = os.environ.get("WORKTREE_PER_SPAWN", "1") not in ("0", "false", "no")
WORKTREE_BASE_BRANCH = os.environ.get("WORKTREE_BASE_BRANCH", "develop")
WORKTREE_STALE_HOURS = float(os.environ.get("WORKTREE_STALE_HOURS", "1"))
WORKTREE_SUBDIR_NAME = os.environ.get("WORKTREE_SUBDIR_NAME", ".spawn-worktrees")
# Phase-7: bounded parallelism for `git worktree add`. Phase-6 used a
# single-permit threading.Lock (effectively serial); the 2026-05-10 burst
# test showed that 4 concurrent worktree-adds is the safe ceiling on this
# host. Higher values fork-fail (EAGAIN). Override via WORKTREE_ADD_PARALLEL.
WORKTREE_ADD_PARALLEL = int(os.environ.get("WORKTREE_ADD_PARALLEL", "4"))

# Module-wide bounded semaphore that caps parallel `git worktree add`
# invocations at WORKTREE_ADD_PARALLEL (default 4). Replaces Phase-6's
# threading.Lock(). Same `with _worktree_add_lock:` call-site contract.
# Raising above 4 risks fork() EAGAIN on this host (RLIMIT_NPROC pressure
# from concurrent claude subprocesses); do not raise without re-verifying.
_worktree_add_lock = threading.BoundedSemaphore(WORKTREE_ADD_PARALLEL)

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("claude-spawner-agent")


# --- Subscription guard ----------------------------------------------------

def subscription_guard_message() -> str | None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return ("ANTHROPIC_API_KEY is set in spawner env; refusing per "
                "zero-dollar rule (agent-memory/feedback_no_api_key_billing.md).")
    return None


# --- Path allow-list validation -------------------------------------------

def validate_allow_list(paths: list[str]) -> tuple[list[str], list[str]]:
    """Return (accepted, rejected_with_reason).

    A path is accepted iff:
      1. It does NOT match PATH_BLOCKLIST_RE.
      2. After resolution, it is under ALLOWED_ROOT (or equal to it).
      3. The resolved path exists OR is a child of an existing dir under
         ALLOWED_ROOT (so we can pass paths to repos that may not exist
         yet on this Mac — gh-checked-out branches etc).
    """
    accepted: list[str] = []
    rejected: list[str] = []
    for raw in (paths or []):
        if not isinstance(raw, str) or not raw.strip():
            rejected.append(f"{raw!r}: empty")
            continue
        # Expand ~
        expanded = os.path.expanduser(raw.strip())
        if PATH_BLOCKLIST_RE.match(expanded):
            rejected.append(f"{raw!r}: matches blocklist")
            continue
        try:
            resolved = Path(expanded).resolve(strict=False)
        except Exception as e:
            rejected.append(f"{raw!r}: resolve failed {e}")
            continue
        try:
            resolved.relative_to(ALLOWED_ROOT)
        except ValueError:
            # If the path doesn't exist yet, also accept if its first
            # existing ancestor is under ALLOWED_ROOT.
            anc = resolved
            ok = False
            for _ in range(20):
                if anc.exists():
                    try:
                        anc.relative_to(ALLOWED_ROOT)
                        ok = True
                    except ValueError:
                        pass
                    break
                anc = anc.parent
            if not ok:
                rejected.append(f"{raw!r}: outside ALLOWED_ROOT={ALLOWED_ROOT}")
                continue
        accepted.append(str(resolved))
    return accepted, rejected


# --- Binary digest (cached) ------------------------------------------------

_BINARY_CACHE: tuple[str, str] | None = None
_BINARY_CACHE_LOCK = threading.Lock()


def binary_path_and_sha256() -> tuple[str, str]:
    global _BINARY_CACHE
    with _BINARY_CACHE_LOCK:
        if _BINARY_CACHE is not None:
            return _BINARY_CACHE
        p = Path(CLAUDE_BINARY)
        try:
            resolved = p.resolve()
        except Exception:
            resolved = p
        if resolved.exists() and resolved.is_file():
            h = hashlib.sha256()
            with resolved.open("rb") as f:
                for chunk in iter(lambda: f.read(64 * 1024), b""):
                    h.update(chunk)
            _BINARY_CACHE = (str(resolved), h.hexdigest())
        else:
            h = hashlib.sha256(str(resolved).encode("utf-8")).hexdigest()
            _BINARY_CACHE = (str(resolved), f"path:{h}")
        log.info("binary_path=%s binary_sha256=%s",
                 _BINARY_CACHE[0], _BINARY_CACHE[1][:16])
        return _BINARY_CACHE


def claude_version_str() -> str:
    try:
        out = subprocess.check_output(
            [CLAUDE_BINARY, "--version"],
            text=True, timeout=5,
            env={**os.environ, "ANTHROPIC_API_KEY": ""},
        )
        return out.strip().splitlines()[0]
    except Exception as e:
        return f"<error:{e}>"


# --- Persistent state ------------------------------------------------------

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS claude_sessions (
    spawn_id            TEXT PRIMARY KEY,
    slot_id             TEXT,
    task_id             TEXT,
    bucket              TEXT,
    host                TEXT,
    pid                 INTEGER,
    status              TEXT NOT NULL,
    started_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at        TIMESTAMP,
    duration_ms         INTEGER,
    exit_code           INTEGER,
    session_id          TEXT,
    model               TEXT,
    binary_path         TEXT,
    binary_sha256       TEXT,
    spawn_callback_url  TEXT,
    release_url         TEXT,
    heartbeat_url       TEXT,
    error               TEXT,
    task_spec_json      TEXT,
    permission_mode     TEXT,
    allow_list_json     TEXT,
    risk_tier           TEXT,
    cwd                 TEXT,
    initial_sha         TEXT,
    final_sha           TEXT,
    branch              TEXT,
    files_touched       INTEGER,
    commits_made        INTEGER,
    pr_url              TEXT,
    auto_merge_enabled  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_claude_sessions_status ON claude_sessions(status);
CREATE INDEX IF NOT EXISTS idx_claude_sessions_started_at ON claude_sessions(started_at);

CREATE TABLE IF NOT EXISTS spawner_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    spawn_id    TEXT,
    event       TEXT NOT NULL,
    detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_spawner_events_ts ON spawner_events(ts);
"""

PHASE5_MIGRATIONS = [
    "ALTER TABLE claude_sessions ADD COLUMN permission_mode TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN allow_list_json TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN risk_tier TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN cwd TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN initial_sha TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN final_sha TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN branch TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN files_touched INTEGER",
    "ALTER TABLE claude_sessions ADD COLUMN commits_made INTEGER",
    "ALTER TABLE claude_sessions ADD COLUMN pr_url TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN auto_merge_enabled INTEGER NOT NULL DEFAULT 0",
]

# LAI phase 7: router-gate + optimizer columns. Idempotent (db() skips ALTERs
# whose column already exists). claude_invoked is the headline boolean for
# spawn-record analytics; the rest are optimizer telemetry per the v2 patch.
PHASE7_MIGRATIONS = [
    "ALTER TABLE claude_sessions ADD COLUMN claude_invoked INTEGER",
    "ALTER TABLE claude_sessions ADD COLUMN router_tier TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN router_intent TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN router_confidence REAL",
    "ALTER TABLE claude_sessions ADD COLUMN response_preview TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN optimizer_backend TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN optimizer_pre_tokens INTEGER",
    "ALTER TABLE claude_sessions ADD COLUMN optimizer_post_tokens INTEGER",
    "ALTER TABLE claude_sessions ADD COLUMN optimizer_compression REAL",
    "ALTER TABLE claude_sessions ADD COLUMN optimizer_stages_run TEXT",
    "ALTER TABLE claude_sessions ADD COLUMN optimizer_wall_ms INTEGER",
    "ALTER TABLE claude_sessions ADD COLUMN optimizer_error TEXT",
]


_db_conn: sqlite3.Connection | None = None
_db_lock = threading.Lock()


def db() -> sqlite3.Connection:
    global _db_conn
    if _db_conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.executescript(DB_SCHEMA)
        # Phase 5 + Phase 7 idempotent migrations
        existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(claude_sessions)").fetchall()}
        for stmt in PHASE5_MIGRATIONS + PHASE7_MIGRATIONS:
            col_name = stmt.split("ADD COLUMN ")[1].split()[0]
            if col_name in existing_cols:
                continue
            try:
                conn.execute(stmt)
                existing_cols.add(col_name)
            except sqlite3.OperationalError as e:
                log.warning("migration %r skipped: %s", stmt, e)
        conn.commit()
        _db_conn = conn
    return _db_conn


def journal_event(spawn_id: str | None, event: str, detail: str | None = None) -> None:
    with _db_lock:
        c = db()
        c.execute("INSERT INTO spawner_events (spawn_id, event, detail) VALUES (?, ?, ?)",
                  (spawn_id, event, detail))
        c.commit()


def journal_insert_starting(payload: dict[str, Any], *,
                            permission_mode: str,
                            allow_list: list[str],
                            risk_tier: str | None,
                            cwd: str | None) -> None:
    with _db_lock:
        c = db()
        c.execute(
            "INSERT INTO claude_sessions (spawn_id, slot_id, task_id, bucket, host, "
            "  status, spawn_callback_url, release_url, heartbeat_url, task_spec_json, "
            "  permission_mode, allow_list_json, risk_tier, cwd) "
            "VALUES (?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                payload["spawn_id"],
                payload.get("slot_id"),
                payload.get("task_id"),
                payload.get("bucket"),
                payload.get("host"),
                payload.get("spawn_callback_url"),
                payload.get("release_url"),
                payload.get("heartbeat_url"),
                json.dumps(payload.get("task_spec") or {}),
                permission_mode,
                json.dumps(allow_list),
                risk_tier,
                cwd,
            )
        )
        c.commit()


def journal_set_running(spawn_id: str, pid: int, *,
                        initial_sha: str | None = None,
                        branch: str | None = None) -> None:
    with _db_lock:
        c = db()
        c.execute("UPDATE claude_sessions SET status='running', pid=?, "
                  "  initial_sha=COALESCE(?, initial_sha), "
                  "  branch=COALESCE(?, branch) "
                  "WHERE spawn_id=?",
                  (pid, initial_sha, branch, spawn_id))
        c.commit()


def journal_finalize(spawn_id: str, status: str, *,
                     exit_code: int | None = None,
                     duration_ms: int | None = None,
                     session_id: str | None = None,
                     model: str | None = None,
                     binary_path: str | None = None,
                     binary_sha256: str | None = None,
                     error: str | None = None,
                     final_sha: str | None = None,
                     files_touched: int | None = None,
                     commits_made: int | None = None,
                     pr_url: str | None = None,
                     auto_merge_enabled: bool = False,
                     # LAI phase 7: router-gate + optimizer telemetry.
                     # All optional + COALESCEd so existing call-sites that
                     # don't pass them leave the columns intact.
                     claude_invoked: bool | None = None,
                     router_tier: str | None = None,
                     router_intent: str | None = None,
                     router_confidence: float | None = None,
                     response_preview: str | None = None,
                     optimizer_backend: str | None = None,
                     optimizer_pre_tokens: int | None = None,
                     optimizer_post_tokens: int | None = None,
                     optimizer_compression: float | None = None,
                     optimizer_stages_run: list[str] | None = None,
                     optimizer_wall_ms: int | None = None,
                     optimizer_error: str | None = None) -> None:
    claude_invoked_db = (None if claude_invoked is None
                         else (1 if claude_invoked else 0))
    stages_db = (None if optimizer_stages_run is None
                 else json.dumps(optimizer_stages_run))
    with _db_lock:
        c = db()
        c.execute(
            "UPDATE claude_sessions SET status=?, completed_at=CURRENT_TIMESTAMP, "
            "  duration_ms=?, exit_code=?, session_id=?, model=?, "
            "  binary_path=?, binary_sha256=?, error=?, "
            "  final_sha=COALESCE(?, final_sha), "
            "  files_touched=COALESCE(?, files_touched), "
            "  commits_made=COALESCE(?, commits_made), "
            "  pr_url=COALESCE(?, pr_url), "
            "  auto_merge_enabled=?, "
            "  claude_invoked=COALESCE(?, claude_invoked), "
            "  router_tier=COALESCE(?, router_tier), "
            "  router_intent=COALESCE(?, router_intent), "
            "  router_confidence=COALESCE(?, router_confidence), "
            "  response_preview=COALESCE(?, response_preview), "
            "  optimizer_backend=COALESCE(?, optimizer_backend), "
            "  optimizer_pre_tokens=COALESCE(?, optimizer_pre_tokens), "
            "  optimizer_post_tokens=COALESCE(?, optimizer_post_tokens), "
            "  optimizer_compression=COALESCE(?, optimizer_compression), "
            "  optimizer_stages_run=COALESCE(?, optimizer_stages_run), "
            "  optimizer_wall_ms=COALESCE(?, optimizer_wall_ms), "
            "  optimizer_error=COALESCE(?, optimizer_error) "
            "WHERE spawn_id=?",
            (status, duration_ms, exit_code, session_id, model,
             binary_path, binary_sha256, error,
             final_sha, files_touched, commits_made, pr_url,
             1 if auto_merge_enabled else 0,
             claude_invoked_db, router_tier, router_intent, router_confidence,
             response_preview,
             optimizer_backend, optimizer_pre_tokens, optimizer_post_tokens,
             optimizer_compression, stages_db, optimizer_wall_ms,
             optimizer_error,
             spawn_id)
        )
        c.commit()


def journal_lookup(spawn_id: str) -> dict[str, Any] | None:
    with _db_lock:
        row = db().execute(
            "SELECT * FROM claude_sessions WHERE spawn_id=?",
            (spawn_id,)
        ).fetchone()
        return dict(row) if row else None


# --- Recovery on startup ---------------------------------------------------

def _pid_is_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False
    except Exception:
        return False


def reconcile_inflight() -> dict[str, int]:
    counts = {"alive_orphans": 0, "dead": 0, "starting_only": 0}
    with _db_lock:
        rows = db().execute(
            "SELECT spawn_id, pid, status, slot_id, spawn_callback_url, "
            "  bucket, host, task_id "
            "FROM claude_sessions WHERE status IN ('starting','running')"
        ).fetchall()
    if not rows:
        log.info("recovery: 0 in-flight rows")
        return counts

    log.warning("recovery: found %d in-flight rows from previous spawner run", len(rows))
    for r in rows:
        spawn_id = r["spawn_id"]
        pid      = r["pid"]
        if r["status"] == "starting" and not pid:
            counts["starting_only"] += 1
            error = "spawner restarted before subprocess was launched"
        elif _pid_is_alive(pid):
            counts["alive_orphans"] += 1
            try:
                os.kill(pid, signal.SIGTERM)
                for _ in range(20):
                    time.sleep(0.1)
                    if not _pid_is_alive(pid):
                        break
                if _pid_is_alive(pid):
                    os.kill(pid, signal.SIGKILL)
            except Exception as e:
                log.warning("recovery: kill pid=%s failed: %s", pid, e)
            error = f"spawner restarted; orphan claude pid={pid} killed"
        else:
            counts["dead"] += 1
            error = f"spawner restarted; claude pid={pid} was already gone"

        journal_finalize(
            spawn_id, "interrupted",
            exit_code=-99, error=error,
        )
        journal_event(spawn_id, "recovery-interrupted", error)
        log.warning("recovery: spawn_id=%s slot=%s pid=%s -> interrupted (%s)",
                    spawn_id, r["slot_id"], pid, error)

        cb = r["spawn_callback_url"]
        if cb:
            asyncio.run(_safe_callback(cb, {
                "spawn_id":          spawn_id,
                "slot_id":           r["slot_id"],
                "bucket":            r["bucket"],
                "host":              r["host"],
                "task_id":           r["task_id"],
                "outcome":           "interrupted",
                "exit_code":         -99,
                "subscription_only": True,
                "error":             error,
            }))

    log.warning("recovery summary: %s", counts)
    return counts


async def _safe_callback(url: str, body: dict[str, Any]) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(url, json=body)
            log.info("callback %s -> HTTP %d", url, r.status_code)
    except Exception as e:
        log.warning("callback %s failed (non-fatal): %s", url, e)


# --- Self-registration on startup ------------------------------------------

async def self_register() -> None:
    if not AUTO_REGISTER:
        log.info("AUTO_REGISTER disabled — skipping self-register")
        return
    body = {
        "name":        HOST_NAME,
        "spawner_url": SELF_SPAWNER_URL,
        "hostname":    os.uname().nodename,
        "version":     VERSION,
        "notes":       f"real Mac claude-spawner-agent (Phase 5: real-edit mode + auto-PR)",
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{SLOT_MANAGER_URL}/admin/host/register",
                json=body,
            )
            log.info("self-register %s/%s -> HTTP %d body=%s",
                     SLOT_MANAGER_URL, HOST_NAME, r.status_code, r.text[:200])
    except Exception as e:
        log.warning("self-register %s failed (non-fatal): %s", SLOT_MANAGER_URL, e)


async def heartbeat_forever(interval_s: float = 60.0) -> None:
    if not AUTO_REGISTER:
        return
    while True:
        await asyncio.sleep(interval_s)
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.post(
                    f"{SLOT_MANAGER_URL}/admin/host/heartbeat",
                    json={"name": HOST_NAME},
                )
                if r.status_code != 200:
                    log.warning("heartbeat -> HTTP %d body=%s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("heartbeat failed (non-fatal): %s", e)


# --- Prompt builders -------------------------------------------------------

def build_prompt_plan_only(task_spec: dict[str, Any]) -> str:
    """Phase 3 ack-only prompt — kept for permission_mode=plan."""
    nid    = task_spec.get("id", "<unknown>")
    title  = task_spec.get("title", "<no title>")
    bucket = task_spec.get("target_bucket") or task_spec.get("resolved_bucket") or "<no bucket>"
    pm     = task_spec.get("prompt_material", {}) or {}
    refs   = pm.get("must_read_first") or []
    scope  = pm.get("scope_tag") or task_spec.get("scope_tag") or "?"
    item   = pm.get("item_code") or task_spec.get("item_code") or "?"

    refs_block = "\n".join(f"- {r}" for r in refs) if refs else "(none provided)"
    return (
        "You are spawned by the slot-manager autonomous loop in PLAN-ONLY mode.\n"
        "DO NOT begin executing the backlog work. Confirm readiness only.\n"
        "\n"
        f"Task spec:\n"
        f"  id          : {nid}\n"
        f"  item_code   : {item}\n"
        f"  scope_tag   : {scope}\n"
        f"  bucket      : {bucket}\n"
        f"  title       : {title}\n"
        f"\n"
        f"Must-read-first refs (acknowledge only — do not actually read):\n"
        f"{refs_block}\n"
        "\n"
        "Reply with ONE compact line of JSON, no prose:\n"
        '  {"ack": true, "task_id": "<the id above>", "ready": true, "model": "<your model>"}\n'
    )


def build_prompt_real_edit(task_spec: dict[str, Any], *,
                           permission_mode: str,
                           cwd: str,
                           branch: str,
                           spawn_id: str,
                           risk_tier: str | None) -> str:
    """Real-edit prompt for permission_mode in {acceptEdits, bypassPermissions}.

    Tells claude:
      - The task to perform (from task_spec.prompt_material).
      - The branch to commit to.
      - Required commit footer.
      - When to stop.
    """
    nid    = task_spec.get("id", "<unknown>")
    title  = task_spec.get("title", "<no title>")
    bucket = task_spec.get("target_bucket") or task_spec.get("resolved_bucket") or "<no bucket>"
    pm     = task_spec.get("prompt_material", {}) or {}
    refs   = pm.get("must_read_first") or []
    work   = pm.get("work_directive") or task_spec.get("work_directive") or pm.get("description") or task_spec.get("description") or title
    scope  = pm.get("scope_tag") or task_spec.get("scope_tag") or "?"
    item   = pm.get("item_code") or task_spec.get("item_code") or "?"
    files  = pm.get("file_scope") or task_spec.get("file_scope")

    refs_block = "\n".join(f"- {r}" for r in refs) if refs else "(none provided)"
    files_block = (f"\nFile scope (only edit these unless absolutely necessary):\n  {files}\n"
                   if files else "")
    return (
        "You are spawned by the slot-manager autonomous loop in REAL-EDIT mode.\n"
        f"  permission_mode : {permission_mode}\n"
        f"  risk_tier       : {risk_tier or 'low'}\n"
        f"  spawn_id        : {spawn_id}\n"
        f"  working dir     : {cwd}\n"
        f"  branch          : {branch} (already checked out for you)\n"
        "\n"
        "TASK:\n"
        f"  id        : {nid}\n"
        f"  item_code : {item}\n"
        f"  scope_tag : {scope}\n"
        f"  bucket    : {bucket}\n"
        f"  title     : {title}\n"
        f"  directive : {work}\n"
        f"{files_block}"
        "\n"
        "Must-read-first refs:\n"
        f"{refs_block}\n"
        "\n"
        "RULES:\n"
        f"1. Stay inside {cwd}. Do not edit files outside this tree.\n"
        f"2. Commit in small, focused chunks. Every commit message MUST include the footer\n"
        f"   `{SPAWNED_BY_TRAILER}` (it can be the only line if needed). The spawner appends\n"
        f"   it for you if you forget, but your messages are clearer if you include it.\n"
        "3. Do NOT push, do NOT open PRs, do NOT touch git remotes. The spawner handles\n"
        "   push + PR + auto-merge after you exit.\n"
        "4. If the directive is impossible or already done, leave the branch unchanged\n"
        "   and exit with a brief explanation. Empty branches will not produce a PR.\n"
        "5. When done, output ONE final compact line of JSON to summarise:\n"
        '   {"ok": true, "task_id": "<id>", "files_touched": <int>, "commits_made": <int>, "summary": "<one-line>"}\n'
        "\n"
        "Begin."
    )


# --- Git helpers (used for cwd capture, branch prep, auto-PR) -------------

def _git(cmd: list[str], cwd: str, *, check: bool = True,
         timeout: float = 15.0) -> subprocess.CompletedProcess:
    """Run a git subcommand. Returns CompletedProcess. Raises on failure if check."""
    return subprocess.run(
        ["git", "-C", cwd, *cmd],
        text=True, capture_output=True, timeout=timeout, check=check,
    )


def capture_git_state(cwd: str) -> dict[str, Any]:
    try:
        sha = _git(["rev-parse", "HEAD"], cwd).stdout.strip()
    except Exception as e:
        return {"ok": False, "error": f"rev-parse: {e}"}
    try:
        branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.strip()
    except Exception:
        branch = ""
    try:
        dirty = bool(_git(["status", "--porcelain"], cwd).stdout.strip())
    except Exception:
        dirty = False
    return {"ok": True, "sha": sha, "branch": branch, "dirty": dirty}


def _safe_branch_name(task_id: str, spawn_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", task_id).strip("-")[:60]
    short = spawn_id.split("-")[0][:8]
    return f"auto/{safe}-{short}"


def _resolve_worktree_base_ref(repo_root: str) -> tuple[str, str]:
    """Pick the freshest known base for a new worktree.

    Tries (in order): origin/<WORKTREE_BASE_BRANCH>, origin/master, origin/main,
    refs/heads/master, HEAD. Returns (ref, source-tag) where source-tag indicates
    which fallback fired (for journaling).
    """
    # Best-effort fetch so worktree branches off the freshest tip. Never block.
    try:
        subprocess.run(
            ["git", "-C", repo_root, "fetch", "origin",
             WORKTREE_BASE_BRANCH, "--quiet"],
            text=True, capture_output=True, timeout=20, check=False,
        )
    except Exception:
        pass
    candidates = [
        (f"origin/{WORKTREE_BASE_BRANCH}", f"origin/{WORKTREE_BASE_BRANCH}"),
        (f"refs/remotes/origin/{WORKTREE_BASE_BRANCH}", f"origin/{WORKTREE_BASE_BRANCH}"),
        ("origin/master",                "origin/master"),
        ("origin/main",                  "origin/main"),
        ("refs/heads/master",            "local/master"),
        ("refs/heads/main",              "local/main"),
        ("HEAD",                         "HEAD"),
    ]
    for ref, tag in candidates:
        r = subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "--verify", ref],
            text=True, capture_output=True, timeout=10, check=False,
        )
        if r.returncode == 0 and r.stdout.strip():
            return ref, tag
    return "HEAD", "HEAD-fallback-final"


def _spawn_worktree_path(repo_root: str, task_id: str, spawn_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", task_id).strip("-")[:60]
    short = (spawn_id.split("-")[0] or "")[:8] or uuid.uuid4().hex[:8]
    subdir = f"{safe}-{short}"
    return Path(repo_root) / WORKTREE_SUBDIR_NAME / subdir


def prepare_branch_for_spawn(cwd: str, task_id: str, spawn_id: str) -> dict[str, Any]:
    """Phase 6: create a per-spawn git worktree under
    `<cwd>/.spawn-worktrees/<task_id>-<short>` branched off origin/develop.

    The returned dict has `worktree_path` set to the new working directory,
    which the caller MUST use as the effective cwd for the claude subprocess
    AND every subsequent git/auto-PR helper. The original `cwd` (the main
    checkout) is untouched and remains the orchestrator's working tree.

    If WORKTREE_PER_SPAWN is disabled, falls back to the Phase-5 in-place
    behaviour (mutates the main checkout's HEAD; cap > 1 unsafe).
    """
    if not WORKTREE_PER_SPAWN:
        return _legacy_prepare_branch_for_spawn(cwd, task_id, spawn_id)

    # Validate cwd is a git repo (capture_git_state will fail if not).
    state = capture_git_state(cwd)
    if not state.get("ok"):
        return state

    repo_root = cwd
    base_ref, base_tag = _resolve_worktree_base_ref(repo_root)
    branch = _safe_branch_name(task_id, spawn_id)
    worktree_path = _spawn_worktree_path(repo_root, task_id, spawn_id)

    # Make parent dir; harmless if exists.
    try:
        worktree_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        return {"ok": False, "error": f"mkdir {worktree_path.parent}: {e}"}

    # If the path already exists (crashed prior spawn left it), nuke it
    # cleanly via `git worktree remove --force` (then prune) before recreating.
    if worktree_path.exists():
        subprocess.run(
            ["git", "-C", repo_root, "worktree", "remove", "--force", str(worktree_path)],
            text=True, capture_output=True, timeout=30, check=False,
        )
        subprocess.run(
            ["git", "-C", repo_root, "worktree", "prune"],
            text=True, capture_output=True, timeout=15, check=False,
        )
        if worktree_path.exists():
            import shutil
            shutil.rmtree(worktree_path, ignore_errors=True)

    # Create worktree with a fresh branch. Serialise via _worktree_add_lock
    # to avoid racing on git's `.git/worktrees/` index (observed: parallel
    # `worktree add` invocations occasionally hit "cannot lock ref"). The
    # lock is module-wide; per-repo would be marginally finer but the
    # critical section is short enough that it doesn't matter.
    #
    # If the branch ref already exists (collision on truncated spawn-id
    # prefix, or a crashed prior spawn left it), retry with a uniquified
    # name including a microsecond+random suffix.
    with _worktree_add_lock:
        add_res = subprocess.run(
            ["git", "-C", repo_root, "worktree", "add", "-b", branch,
             str(worktree_path), base_ref],
            text=True, capture_output=True, timeout=60, check=False,
        )
        if add_res.returncode != 0:
            unique_branch = (f"{branch}-{int(time.time() * 1000) % 10**9}"
                             f"-{uuid.uuid4().hex[:6]}")
            add_res = subprocess.run(
                ["git", "-C", repo_root, "worktree", "add", "-b", unique_branch,
                 str(worktree_path), base_ref],
                text=True, capture_output=True, timeout=60, check=False,
            )
            if add_res.returncode != 0:
                return {
                    "ok": False,
                    "error": (f"git worktree add failed (base_ref={base_ref}): "
                              f"{add_res.stderr[:400]}"),
                }
            branch = unique_branch

    # Capture initial sha from inside the worktree.
    sha_res = subprocess.run(
        ["git", "-C", str(worktree_path), "rev-parse", "HEAD"],
        text=True, capture_output=True, timeout=10, check=False,
    )
    if sha_res.returncode != 0:
        # Try to clean up the worktree we just created.
        subprocess.run(
            ["git", "-C", repo_root, "worktree", "remove", "--force", str(worktree_path)],
            text=True, capture_output=True, timeout=30, check=False,
        )
        return {"ok": False, "error": f"rev-parse in worktree: {sha_res.stderr[:300]}"}

    return {
        "ok":            True,
        "sha":           sha_res.stdout.strip(),
        "branch":        branch,
        "worktree_path": str(worktree_path),
        "worktree_used": True,
        "base_ref":      base_ref,
        "base_tag":      base_tag,
        "reused":        False,
    }


def _legacy_prepare_branch_for_spawn(cwd: str, task_id: str, spawn_id: str) -> dict[str, Any]:
    """Phase-5 in-place branch prep. Kept for emergency rollback only —
    NOT safe with cap > 1 (parallel spawns share auto/ branch on same tree).
    """
    state = capture_git_state(cwd)
    if not state.get("ok"):
        return state
    if state.get("dirty"):
        return {"ok": False, "error": f"working tree dirty in {cwd}"}
    if state.get("branch", "").startswith("auto/"):
        return {"ok": True, "sha": state["sha"], "branch": state["branch"], "reused": True}
    branch = _safe_branch_name(task_id, spawn_id)
    try:
        _git(["checkout", "-B", branch], cwd)
    except subprocess.CalledProcessError as e:
        return {"ok": False, "error": f"checkout -B {branch}: {e.stderr or e.stdout}"}
    return {"ok": True, "sha": state["sha"], "branch": branch, "reused": False,
            "worktree_used": False}


def cleanup_worktree(repo_root: str, worktree_path: str) -> dict[str, Any]:
    """Remove a per-spawn worktree. Force-removes even if dirty so we never
    leak disk after a crashed spawn. The branch ref persists locally (it's
    been pushed to origin during auto-PR) — that's intentional, it lets the
    PR keep its base.
    """
    try:
        if not worktree_path:
            return {"ok": True, "skipped": True}
        r = subprocess.run(
            ["git", "-C", repo_root, "worktree", "remove", "--force", worktree_path],
            text=True, capture_output=True, timeout=30, check=False,
        )
        ok = r.returncode == 0
        # Always prune to clean up any orphaned metadata.
        subprocess.run(
            ["git", "-C", repo_root, "worktree", "prune"],
            text=True, capture_output=True, timeout=15, check=False,
        )
        # Last-resort filesystem cleanup if git still left bytes behind.
        if Path(worktree_path).exists():
            import shutil
            shutil.rmtree(worktree_path, ignore_errors=True)
        return {"ok": True, "git_remove_ok": ok,
                "stderr": r.stderr[:200] if not ok else None}
    except Exception as e:
        return {"ok": False, "error": f"cleanup_worktree: {e}"}


def prune_stale_worktrees(repo_root: str, max_age_seconds: float) -> dict[str, Any]:
    """At startup: scan `git worktree list` and prune any
    `.spawn-worktrees/*` entries whose dir mtime is older than max_age_seconds.
    Prevents disk leak from crashed spawns.
    """
    try:
        if not Path(repo_root).is_dir() or not (Path(repo_root) / ".git").exists():
            return {"ok": True, "skipped": "not a git repo", "repo_root": repo_root}
        r = subprocess.run(
            ["git", "-C", repo_root, "worktree", "list", "--porcelain"],
            text=True, capture_output=True, timeout=15, check=False,
        )
        if r.returncode != 0:
            return {"ok": False, "error": f"worktree list: {r.stderr[:200]}"}

        worktrees: list[dict] = []
        cur: dict = {}
        for line in r.stdout.splitlines():
            if not line.strip():
                if cur:
                    worktrees.append(cur)
                    cur = {}
                continue
            if line.startswith("worktree "):
                cur["path"] = line[len("worktree "):].strip()
            elif line.startswith("HEAD "):
                cur["head"] = line[len("HEAD "):].strip()
            elif line.startswith("branch "):
                cur["branch"] = line[len("branch "):].strip()
        if cur:
            worktrees.append(cur)

        marker = f"{os.sep}{WORKTREE_SUBDIR_NAME}{os.sep}"
        pruned: list[str] = []
        kept: list[str] = []
        now = time.time()
        for w in worktrees:
            p = w.get("path") or ""
            if marker not in p:
                continue
            try:
                mtime = Path(p).stat().st_mtime
                age = now - mtime
            except FileNotFoundError:
                # Dir already gone — git just has stale metadata. Prune.
                pruned.append(p)
                continue
            except Exception:
                continue
            if age >= max_age_seconds:
                subprocess.run(
                    ["git", "-C", repo_root, "worktree", "remove", "--force", p],
                    text=True, capture_output=True, timeout=30, check=False,
                )
                if Path(p).exists():
                    import shutil
                    shutil.rmtree(p, ignore_errors=True)
                pruned.append(p)
            else:
                kept.append(p)
        # Final prune to drop any orphaned metadata.
        subprocess.run(
            ["git", "-C", repo_root, "worktree", "prune"],
            text=True, capture_output=True, timeout=15, check=False,
        )
        return {"ok": True, "repo_root": repo_root,
                "pruned": pruned, "kept": kept,
                "max_age_seconds": max_age_seconds}
    except Exception as e:
        return {"ok": False, "error": f"prune_stale_worktrees: {e}"}


def prune_stale_worktrees_under_allowed_root() -> list[dict[str, Any]]:
    """Walk top-level dirs under ALLOWED_ROOT and prune stale worktrees in
    every git repo we find. Plus ALLOWED_ROOT itself if it's a repo.
    """
    results: list[dict[str, Any]] = []
    max_age = WORKTREE_STALE_HOURS * 3600.0
    candidates: list[Path] = []
    if (ALLOWED_ROOT / ".git").exists():
        candidates.append(ALLOWED_ROOT)
    try:
        for child in ALLOWED_ROOT.iterdir():
            if child.is_dir() and (child / ".git").exists():
                candidates.append(child)
    except Exception as e:
        log.warning("startup worktree scan: iterdir(%s) failed: %s", ALLOWED_ROOT, e)
    for repo in candidates:
        try:
            res = prune_stale_worktrees(str(repo), max_age)
            results.append(res)
        except Exception as e:
            results.append({"ok": False, "repo_root": str(repo), "error": str(e)})
    return results


def detect_commits_made(cwd: str, initial_sha: str) -> dict[str, Any]:
    try:
        head = _git(["rev-parse", "HEAD"], cwd).stdout.strip()
    except Exception as e:
        return {"ok": False, "error": f"rev-parse: {e}"}
    if head == initial_sha:
        return {"ok": True, "head": head, "count": 0, "commits": [], "files_touched": 0}
    try:
        commits = _git(["log", "--format=%H%x09%s", f"{initial_sha}..{head}"], cwd).stdout
        commit_lines = [ln for ln in commits.splitlines() if ln.strip()]
    except Exception as e:
        return {"ok": False, "error": f"log: {e}"}
    try:
        files = _git(["diff", "--name-only", f"{initial_sha}..{head}"], cwd).stdout
        files_touched = len([ln for ln in files.splitlines() if ln.strip()])
    except Exception:
        files_touched = 0
    return {"ok": True, "head": head, "count": len(commit_lines),
            "commits": commit_lines, "files_touched": files_touched}


def ensure_spawned_by_trailer(cwd: str, initial_sha: str) -> dict[str, Any]:
    """Rewrite commits in initial_sha..HEAD to ensure each has the
    Spawned-By trailer. We do this with `git rebase --exec` calling
    `git commit --amend --no-edit --trailer ...` on each commit.

    `git interpret-trailers` (used internally by --trailer) is idempotent
    when ifExists=addIfDifferent (default), so commits that already have
    the trailer (because claude obeyed the prompt) are not duplicated.
    """
    try:
        # First check: are any commits missing the trailer?
        log_out = _git(
            ["log", f"{initial_sha}..HEAD", "--format=%H%x09%B%x00"],
            cwd,
        ).stdout
        # Split commits by NUL
        commits_missing = []
        for chunk in log_out.split("\x00"):
            if not chunk.strip():
                continue
            sha, _, msg = chunk.partition("\t")
            if SPAWNED_BY_TRAILER not in msg:
                commits_missing.append(sha.strip())

        if not commits_missing:
            return {"ok": True, "skipped": True, "amended": 0}

        # Use rebase --exec to amend each commit with --trailer.
        # The --trailer option was added in git 2.32 (we're on 2.45+).
        exec_cmd = f"git commit --amend --no-edit --no-verify --trailer '{SPAWNED_BY_TRAILER}'"
        result = subprocess.run(
            ["git", "-C", cwd,
             "-c", "advice.detachedHead=false",
             "rebase", "--exec", exec_cmd, initial_sha],
            text=True, capture_output=True, timeout=60, check=False,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0",
                 "GIT_SEQUENCE_EDITOR": ":", "GIT_EDITOR": ":"},
        )
        if result.returncode != 0:
            # Abort the rebase if it left us mid-flight, then fall back
            # to amending HEAD only (best-effort).
            subprocess.run(["git", "-C", cwd, "rebase", "--abort"],
                           text=True, capture_output=True, timeout=10, check=False)
            log.warning("ensure_spawned_by_trailer: rebase failed, "
                        "falling back to amend-HEAD only: %s",
                        result.stderr[:500])
            head_msg = _git(["log", "-1", "--format=%B"], cwd).stdout.rstrip()
            if SPAWNED_BY_TRAILER not in head_msg:
                new_msg = head_msg + "\n\n" + SPAWNED_BY_TRAILER + "\n"
                amend = subprocess.run(
                    ["git", "-C", cwd, "commit", "--amend",
                     "--no-verify", "-m", new_msg],
                    text=True, capture_output=True, timeout=30, check=False,
                )
                if amend.returncode != 0:
                    return {"ok": False,
                            "error": f"amend HEAD: {amend.stderr[:300]}"}
                return {"ok": True, "fallback": "head-only", "amended": 1}
            return {"ok": True, "fallback": "head-already-has-trailer"}
        return {"ok": True, "amended": len(commits_missing)}
    except Exception as e:
        return {"ok": False, "error": f"trailer rewrite: {e}"}


def push_branch(cwd: str, branch: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "push", "-u", "origin", branch],
            text=True, capture_output=True, timeout=60, check=False,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        if result.returncode != 0:
            return {"ok": False, "error": f"push: {result.stderr[:500]}"}
        return {"ok": True, "stdout": result.stdout[:500]}
    except Exception as e:
        return {"ok": False, "error": f"push: {e}"}


def create_pr(cwd: str, branch: str, base: str, title: str, body: str,
              labels: list[str]) -> dict[str, Any]:
    try:
        cmd = ["gh", "pr", "create",
               "--head", branch,
               "--base", base,
               "--title", title,
               "--body", body]
        for lab in labels:
            cmd += ["--label", lab]
        result = subprocess.run(
            cmd, text=True, capture_output=True, timeout=45, check=False, cwd=cwd,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        if result.returncode != 0:
            return {"ok": False, "error": f"gh pr create: {result.stderr[:500]}"}
        url = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
        return {"ok": True, "url": url}
    except Exception as e:
        return {"ok": False, "error": f"gh pr create: {e}"}


def enable_auto_merge(cwd: str, pr_url: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["gh", "pr", "merge", pr_url, "--auto", "--squash"],
            text=True, capture_output=True, timeout=30, check=False, cwd=cwd,
        )
        if result.returncode != 0:
            return {"ok": False, "error": f"gh pr merge --auto: {result.stderr[:500]}"}
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": f"gh pr merge --auto: {e}"}


# --- The actual claude spawn -----------------------------------------------

def run_claude(spawn_id: str,
               prompt: str,
               timeout_s: float,
               *,
               permission_mode: str,
               allow_list: list[str],
               cwd: str | None) -> dict[str, Any]:
    """Synchronously invoke the claude binary in subscription mode.

    Phase 5: builds argv based on permission_mode, attaches --add-dir
    for each allow_list entry, and chdir's into cwd if provided so
    claude's tool-use is rooted there.
    """
    if subscription_guard_message():
        raise RuntimeError("subscription guard violation")

    env = {k: v for k, v in os.environ.items()
           if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    env["PYTHONUNBUFFERED"] = "1"
    env["ANTHROPIC_API_KEY"] = ""

    cmd, headroom_wrapped, prefix_stabilized = _build_claude_argv(
        prompt,
        permission_mode=permission_mode,
        allow_list=allow_list,
        claude_binary=CLAUDE_BINARY,
        permission_mode_max_turns=PERMISSION_MODE_MAX_TURNS,
        headroom_binary=HEADROOM_BINARY,
        headroom_wrap_disable=HEADROOM_WRAP_DISABLE,
        headroom_proxy_port=HEADROOM_PROXY_PORT,
        headroom_proxy_offset=HEADROOM_PROXY_OFFSET,
        headroom_reuse_proxy=os.environ.get("HEADROOM_REUSE_PROXY", "").lower()
                              in ("1", "true", "yes"),
        stabilize_prefix_disable=STABILIZE_PREFIX_DISABLE,
    )

    started = time.time()
    log.info("spawn_id=%s mode=%s allow_list=%d cwd=%s "
             "headroom_wrap=%s prefix_stabilized=%s invoking claude...",
             spawn_id, permission_mode, len(allow_list), cwd or "<inherit>",
             headroom_wrapped, prefix_stabilized)

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        cwd=cwd,
    )
    pid = proc.pid

    stdout = stderr = ""
    rc: int | None = None
    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout_s)
        rc = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        log.warning("spawn_id=%s claude TIMEOUT after %.1fs — sending SIGTERM",
                    spawn_id, timeout_s)
        proc.terminate()
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            log.warning("spawn_id=%s claude refused SIGTERM — SIGKILL", spawn_id)
            proc.kill()
            try:
                stdout, stderr = proc.communicate(timeout=5)
            except Exception:
                stdout = stdout or ""
                stderr = stderr or ""
        rc = proc.returncode
    duration_ms = int((time.time() - started) * 1000)

    parsed = None
    session_id: str | None = None
    model: str | None      = None
    if stdout:
        try:
            parsed = json.loads(stdout)
            session_id = parsed.get("session_id") or parsed.get("conversation_id")
            model      = parsed.get("model")
            if not model:
                mu = parsed.get("modelUsage") or {}
                if isinstance(mu, dict) and mu:
                    model = next(iter(mu.keys()))
        except Exception as e:
            log.warning("spawn_id=%s could not parse stdout JSON: %s", spawn_id, e)

    return {
        "ok":           (rc == 0 and not timed_out),
        "pid":          pid,
        "rc":           rc,
        "timed_out":    timed_out,
        "duration_ms":  duration_ms,
        "session_id":   session_id,
        "model":        model,
        "parsed":       parsed,
        "stdout_head":  (stdout or "")[:2000],
        "stderr_head":  (stderr or "")[:2000],
        "headroom_wrapped":    headroom_wrapped,
        "prefix_stabilized":   prefix_stabilized,
    }


# --- FastAPI app -----------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    guard = subscription_guard_message()
    if guard:
        log.error("STARTUP REFUSED: %s", guard)
        raise SystemExit(2)
    log.info("claude-spawner-agent %s starting on :%d host_name=%s claude=%s",
             VERSION, PORT, HOST_NAME, CLAUDE_BINARY)
    log.info("subscription-guard OK at startup (ANTHROPIC_API_KEY unset)")
    log.info("ALLOWED_ROOT=%s PATH_BLOCKLIST_RE=%s",
             ALLOWED_ROOT, PATH_BLOCKLIST_RE.pattern)
    log.info("WORKTREE_PER_SPAWN=%s base_branch=%s stale_hours=%s subdir=%s",
             WORKTREE_PER_SPAWN, WORKTREE_BASE_BRANCH,
             WORKTREE_STALE_HOURS, WORKTREE_SUBDIR_NAME)
    log.info("LAI phase 7: ROUTER_GATE_ENABLED=%s OPTIMIZER_ENABLED=%s "
             "router_url=%s optimizer_timeout_s=%.1f",
             ROUTER_GATE_ENABLED, OPTIMIZER_ENABLED, ROUTER_URL, OPTIMIZER_TIMEOUT_S)
    headroom_present = bool(HEADROOM_BINARY) and os.path.exists(HEADROOM_BINARY)
    headroom_wrap_active = headroom_present and not HEADROOM_WRAP_DISABLE
    log.info("SPS-α: HEADROOM_BINARY=%s present=%s wrap_disable=%s wrap_active=%s "
             "proxy_port=%d offset=%d stabilize_prefix_disable=%s",
             HEADROOM_BINARY, headroom_present, HEADROOM_WRAP_DISABLE,
             headroom_wrap_active, HEADROOM_PROXY_PORT, HEADROOM_PROXY_OFFSET,
             STABILIZE_PREFIX_DISABLE)
    log.info("claude --version: %s", claude_version_str())
    binary_path_and_sha256()
    journal_event(None, "startup",
                  f"version={VERSION} host={HOST_NAME} "
                  f"worktree_per_spawn={WORKTREE_PER_SPAWN}")

    try:
        reconcile_inflight()
    except Exception as e:
        log.exception("reconciliation failed: %s", e)

    # Phase 6: scrub stale spawn worktrees (older than WORKTREE_STALE_HOURS)
    # left by crashed prior workers. Bounded disk leak.
    if WORKTREE_PER_SPAWN:
        try:
            results = prune_stale_worktrees_under_allowed_root()
            total_pruned = sum(len(r.get("pruned") or []) for r in results)
            total_kept   = sum(len(r.get("kept") or [])   for r in results)
            log.info("worktree pruner: scanned=%d pruned=%d kept=%d",
                     len(results), total_pruned, total_kept)
            for r in results:
                if r.get("pruned"):
                    log.info("worktree pruner: %s pruned=%s",
                             r.get("repo_root"), r.get("pruned"))
            journal_event(None, "worktree-prune-startup",
                          f"scanned={len(results)} pruned={total_pruned} "
                          f"kept={total_kept}")
        except Exception as e:
            log.warning("worktree pruner failed (non-fatal): %s", e)

    if AUTO_REGISTER:
        try:
            await self_register()
        except Exception as e:
            log.warning("self-register error: %s", e)
        hb_task = asyncio.create_task(heartbeat_forever())
    else:
        hb_task = None

    try:
        yield
    finally:
        log.info("claude-spawner-agent shutting down")
        journal_event(None, "shutdown", None)
        if hb_task:
            hb_task.cancel()
            with contextlib.suppress(Exception):
                await hb_task


app = FastAPI(title="Claude Spawner Agent (Mac)", version=VERSION, lifespan=lifespan)


@app.get("/health", response_class=PlainTextResponse)
def health() -> str:
    return "OK"


@app.get("/version")
def version() -> dict[str, Any]:
    bp, sha = binary_path_and_sha256()
    return {
        "service":            "claude-spawner-agent",
        "version":            VERSION,
        "host_name":          HOST_NAME,
        "binary_path":        bp,
        "binary_sha256":      sha,
        "claude_version":     claude_version_str(),
        "subscription_only":  subscription_guard_message() is None,
        "slot_manager_url":   SLOT_MANAGER_URL,
        "self_spawner_url":   SELF_SPAWNER_URL,
        "auto_register":      AUTO_REGISTER,
        "allowed_root":       str(ALLOWED_ROOT),
        "valid_permission_modes": sorted(VALID_PERMISSION_MODES),
        "default_permission_mode": DEFAULT_PERMISSION_MODE,
        "default_pr_base_branch":  DEFAULT_PR_BASE_BRANCH,
        "default_pr_label":        DEFAULT_PR_LABEL,
        "worktree_per_spawn":      WORKTREE_PER_SPAWN,
        "worktree_base_branch":    WORKTREE_BASE_BRANCH,
        "worktree_stale_hours":    WORKTREE_STALE_HOURS,
        "worktree_subdir_name":    WORKTREE_SUBDIR_NAME,
        "router_gate_enabled":     ROUTER_GATE_ENABLED,
        "optimizer_enabled":       OPTIMIZER_ENABLED,
        "headroom_binary":         HEADROOM_BINARY,
        "headroom_present":        bool(HEADROOM_BINARY) and os.path.exists(HEADROOM_BINARY),
        "headroom_wrap_disable":   HEADROOM_WRAP_DISABLE,
        "headroom_proxy_port":     HEADROOM_PROXY_PORT,
        "headroom_proxy_offset":   HEADROOM_PROXY_OFFSET,
        "stabilize_prefix_disable": STABILIZE_PREFIX_DISABLE,
    }


@app.get("/")
def root():
    return {
        "service":   "claude-spawner-agent",
        "version":   VERSION,
        "endpoints": ["/health", "/version", "/spawn", "/admin/sessions",
                      "/admin/sessions/{spawn_id}", "/admin/events",
                      "/admin/validate-allow-list"],
    }


@app.post("/admin/validate-allow-list")
async def admin_validate_allow_list(req: Request) -> JSONResponse:
    """Operator-side helper: dry-run path validation without spawning."""
    body = await req.json()
    paths = body.get("paths") or []
    accepted, rejected = validate_allow_list(paths)
    return JSONResponse({"accepted": accepted, "rejected": rejected,
                         "allowed_root": str(ALLOWED_ROOT),
                         "blocklist_regex": PATH_BLOCKLIST_RE.pattern})


@app.post("/spawn")
async def spawn(request: Request) -> JSONResponse:
    t0 = time.time()
    raw = await request.body()
    payload: dict[str, Any] = await request.json() if raw else {}

    spawn_id  = payload.get("spawn_id") or str(uuid.uuid4())
    task_spec = payload.get("task_spec") or {}
    task_id   = (payload.get("task_id")
                 or task_spec.get("id")
                 or task_spec.get("item_code")
                 or "unknown")
    slot_id   = payload.get("slot_id")
    bucket    = payload.get("bucket")
    host      = payload.get("host")
    heartbeat_url = payload.get("heartbeat_url")
    timeout_s     = float(payload.get("timeout_sec") or DEFAULT_TIMEOUT_S)

    # Phase 5: read new fields with defaults that preserve Phase 3 behaviour.
    permission_mode = (payload.get("permission_mode")
                       or task_spec.get("permission_mode")
                       or DEFAULT_PERMISSION_MODE)
    if permission_mode not in VALID_PERMISSION_MODES:
        permission_mode = DEFAULT_PERMISSION_MODE  # silently fall back

    allow_list_raw = (payload.get("allow_list")
                      or task_spec.get("allow_list")
                      or [])
    risk_tier = (payload.get("risk_tier")
                 or task_spec.get("risk_tier"))
    cwd = (payload.get("cwd")
           or task_spec.get("cwd"))
    auto_pr = bool(payload.get("auto_pr") or task_spec.get("auto_pr"))
    auto_merge = bool(payload.get("auto_merge") or task_spec.get("auto_merge"))

    # Validate allow-list (always — spawner is the last line of defence).
    accepted_paths, rejected_paths = validate_allow_list(allow_list_raw)

    journal_insert_starting({
        "spawn_id": spawn_id,
        "slot_id":  slot_id,
        "task_id":  task_id,
        "bucket":   bucket,
        "host":     host,
        "spawn_callback_url": payload.get("spawn_callback_url"),
        "release_url":        payload.get("release_url"),
        "heartbeat_url":      heartbeat_url,
        "task_spec":          task_spec,
    }, permission_mode=permission_mode,
       allow_list=accepted_paths,
       risk_tier=risk_tier,
       cwd=cwd)
    journal_event(spawn_id, "spawn-received",
                  f"slot={slot_id} bucket={bucket} task={task_id} "
                  f"mode={permission_mode} risk={risk_tier} "
                  f"allow={len(accepted_paths)} rejected={len(rejected_paths)}")

    # 1. Subscription guard.
    guard = subscription_guard_message()
    if guard:
        bp, sha = binary_path_and_sha256()
        journal_finalize(spawn_id, "rejected_guard",
                         duration_ms=int((time.time() - t0) * 1000),
                         binary_path=bp, binary_sha256=sha, error=guard)
        return JSONResponse(status_code=451, content={
            "ok":                False,
            "outcome":           "rejected_guard",
            "subscription_only": False,
            "error":             guard,
            "spawn_id":          spawn_id,
            "binary_path":       bp,
            "binary_sha256":     sha,
        })

    # 2. Path-escape guard (Phase 5).
    if rejected_paths:
        bp, sha = binary_path_and_sha256()
        err = f"allow_list rejected: {rejected_paths}"
        journal_finalize(spawn_id, "rejected_path_escape",
                         duration_ms=int((time.time() - t0) * 1000),
                         binary_path=bp, binary_sha256=sha, error=err)
        return JSONResponse(status_code=451, content={
            "ok":                False,
            "outcome":           "rejected_path_escape",
            "subscription_only": True,
            "error":             err,
            "spawn_id":          spawn_id,
            "rejected_paths":    rejected_paths,
            "allowed_root":      str(ALLOWED_ROOT),
        })

    # 3. Sanity check the dispatch payload.
    require_sub = payload.get("require_subscription", False)
    if not require_sub:
        bp, sha = binary_path_and_sha256()
        journal_finalize(spawn_id, "spawner_error",
                         duration_ms=int((time.time() - t0) * 1000),
                         binary_path=bp, binary_sha256=sha,
                         error="dispatch payload missing require_subscription=true")
        return JSONResponse(status_code=400, content={
            "ok":                False,
            "outcome":           "spawner_error",
            "subscription_only": True,
            "error":             "dispatch payload missing require_subscription=true",
            "spawn_id":          spawn_id,
        })

    # 4. Fire-and-forget heartbeat.
    if heartbeat_url and slot_id:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(heartbeat_url, json={
                    "slot_id": slot_id,
                    "task_id": task_id,
                })
        except Exception as e:
            log.warning("heartbeat to %s failed (non-fatal): %s", heartbeat_url, e)

    # ─── LAI phase 7: pre-spawn classify-and-maybe-route gate ───────────────
    # Only fires for plan-mode (read-only ack) tasks; real-edit modes always
    # go to the claude binary because the local qwen models can't manipulate
    # worktrees/git. If local handles the task we finalize the spawn with
    # outcome=local_completed, claude_invoked=False, and return early.
    router_decision: dict[str, Any] = {"tier": "claude", "reason": "gate-not-evaluated"}
    if ROUTER_GATE_ENABLED and permission_mode == "plan":
        try:
            router_up = router_health(ROUTER_URL)
        except Exception as e:
            router_up = False
            log.warning("router_health(%s) raised %s", ROUTER_URL, e)
        if router_up:
            pm = (task_spec.get("prompt_material") or {})
            spec_text = " ".join(filter(None, [
                task_spec.get("title"),
                pm.get("work_directive") or task_spec.get("work_directive"),
                pm.get("description") or task_spec.get("description"),
            ])) or json.dumps(task_spec)
            try:
                local_response, route_meta = classify_and_maybe_route(
                    spec_text, base_url=ROUTER_URL,
                )
            except Exception as e:
                local_response, route_meta = None, {
                    "tier": "claude",
                    "reason": f"router-call-raised:{type(e).__name__}:{e}",
                }
            router_decision = dict(route_meta)
            journal_event(spawn_id, "router-gate-decision",
                          f"tier={route_meta.get('tier')} "
                          f"reason={str(route_meta.get('reason') or '')[:200]} "
                          f"intent={route_meta.get('intent')} "
                          f"conf={route_meta.get('confidence')}")
            if local_response is not None:
                bp, sha = binary_path_and_sha256()
                preview = (local_response or "")[:200]
                journal_finalize(
                    spawn_id, "local_completed",
                    duration_ms=int((time.time() - t0) * 1000),
                    model=route_meta.get("model"),
                    binary_path=bp, binary_sha256=sha,
                    claude_invoked=False,
                    router_tier=route_meta.get("tier"),
                    router_intent=route_meta.get("intent"),
                    router_confidence=route_meta.get("confidence"),
                    response_preview=preview,
                )
                journal_event(spawn_id, "spawn-local_completed",
                              f"tier={route_meta.get('tier')} "
                              f"model={route_meta.get('model')} "
                              f"intent={route_meta.get('intent')} "
                              f"conf={route_meta.get('confidence')}")
                return JSONResponse(status_code=200, content={
                    "ok":                True,
                    "outcome":           "local_completed",
                    "subscription_only": True,
                    "spawn_id":          spawn_id,
                    "model":             route_meta.get("model"),
                    "tier":              route_meta.get("tier"),
                    "claude_invoked":    False,
                    "response":          local_response,
                })
        else:
            router_decision = {"tier": "claude", "reason": "router-unhealthy"}
            journal_event(spawn_id, "router-gate-skipped",
                          "router /healthz down — falling through to claude")
    elif not ROUTER_GATE_ENABLED:
        router_decision = {"tier": "claude", "reason": "gate-disabled-by-env"}
    else:
        router_decision = {"tier": "claude",
                           "reason": f"gate-skipped-permission_mode={permission_mode}"}

    # 5. If real-edit mode AND cwd provided, prepare branch + capture HEAD.
    #    Phase 6: this also creates a per-spawn git worktree under
    #    `<cwd>/.spawn-worktrees/<task_id>-<short>` and swaps the effective
    #    cwd to that worktree for the rest of the spawn — so cap > 1 spawns
    #    on the same host no longer share `auto/...` branch on the same tree.
    initial_sha: str | None = None
    branch: str | None = None
    repo_root: str | None = cwd  # the orchestrator-owned main checkout
    worktree_path: str | None = None
    worktree_used: bool = False
    if permission_mode in ("acceptEdits", "bypassPermissions") and cwd:
        prep = prepare_branch_for_spawn(cwd, task_id, spawn_id)
        if not prep.get("ok"):
            bp, sha = binary_path_and_sha256()
            err = f"branch prep failed: {prep.get('error')}"
            journal_finalize(spawn_id, "spawner_error",
                             duration_ms=int((time.time() - t0) * 1000),
                             binary_path=bp, binary_sha256=sha, error=err)
            return JSONResponse(status_code=409, content={
                "ok":                False,
                "outcome":           "spawner_error",
                "subscription_only": True,
                "error":             err,
                "spawn_id":          spawn_id,
            })
        initial_sha = prep["sha"]
        branch = prep["branch"]
        worktree_used = bool(prep.get("worktree_used"))
        if worktree_used:
            worktree_path = prep["worktree_path"]
            # Phase 6: SWAP effective cwd to the worktree. Every downstream
            # operation (claude subprocess, commit detection, trailer rewrite,
            # push, gh pr create, auto-merge) MUST run inside the worktree
            # so parallel spawns don't trample each other's HEAD.
            cwd = worktree_path
            # Replace any allow_list entry that pointed at the main checkout
            # with the worktree path (keep other entries intact). Worktree
            # is a child of repo_root so it's already under ALLOWED_ROOT.
            new_accepted: list[str] = []
            for p in accepted_paths:
                try:
                    if Path(p).resolve() == Path(repo_root).resolve():
                        new_accepted.append(worktree_path)
                        continue
                except Exception:
                    pass
                new_accepted.append(p)
            if worktree_path not in new_accepted:
                new_accepted.insert(0, worktree_path)
            accepted_paths = new_accepted
        journal_event(spawn_id, "branch-prepared",
                      f"branch={branch} initial_sha={initial_sha[:10]} "
                      f"reused={prep.get('reused')} worktree={worktree_used} "
                      f"path={worktree_path or '<n/a>'} "
                      f"base_ref={prep.get('base_ref') or '<n/a>'} "
                      f"base_tag={prep.get('base_tag') or '<n/a>'}")

    # 6. Build prompt.
    if permission_mode == "plan":
        prompt = build_prompt_plan_only(task_spec)
    else:
        prompt = build_prompt_real_edit(
            task_spec,
            permission_mode=permission_mode,
            cwd=cwd or "(unset)",
            branch=branch or "(unset)",
            spawn_id=spawn_id,
            risk_tier=risk_tier,
        )

    # ─── LAI phase 7: 3-stage prompt optimizer pre-pass ──────────────────
    # Runs regardless of the router-gate outcome (we're now on the claude
    # path either way). Best-effort: optimize_prompt() never raises, but the
    # `except Exception` is belt-and-suspenders. On any failure the original
    # `prompt` is reused unchanged.
    optimizer_meta: dict[str, Any] = {"backend": "skipped"}
    if OPTIMIZER_ENABLED:
        try:
            optimized_prompt, opt_meta = optimize_prompt(
                prompt, system_prompt=None,
                base_url=ROUTER_URL, timeout=OPTIMIZER_TIMEOUT_S,
            )
            optimizer_meta = opt_meta
            journal_event(spawn_id, "optimizer-applied",
                          f"backend={opt_meta.get('backend')} "
                          f"pre={opt_meta.get('pre_token_count')} "
                          f"post={opt_meta.get('post_token_count')} "
                          f"stages={','.join(opt_meta.get('stages_run') or [])} "
                          f"wall_ms={opt_meta.get('wall_ms')}")
            prompt = optimized_prompt
        except Exception as e:
            optimizer_meta = {
                "backend": "noop",
                "error": f"{type(e).__name__}: {e}",
            }
            journal_event(spawn_id, "optimizer-failed", str(e)[:300])

    # 7. Update journal with initial_sha + branch BEFORE invoking claude
    #    (so reconciliation has the info if we crash mid-spawn).
    if initial_sha or branch:
        journal_set_running(spawn_id, pid=0, initial_sha=initial_sha, branch=branch)

    # 8. Run claude.
    record = await asyncio.to_thread(
        run_claude, spawn_id, prompt, timeout_s,
        permission_mode=permission_mode,
        allow_list=accepted_paths,
        cwd=cwd,
    )
    # PID is set inside run_claude via subprocess.Popen.pid; we update
    # the journal with the real PID for forensics.
    journal_set_running(spawn_id, record["pid"])

    # 9. Decide outcome.
    rc = record["rc"]
    timed_out = record["timed_out"]
    if rc == 0 and not timed_out:
        outcome = "ok"
    elif timed_out:
        outcome = "timeout"
    elif rc is not None and rc < 0:
        outcome = "crashed"
    else:
        outcome = "spawner_error"

    bp, sha = binary_path_and_sha256()
    duration_ms = int((time.time() - t0) * 1000)

    error_field: str | None = None
    if outcome != "ok":
        head = (record.get("stderr_head") or "")[:200].strip()
        error_field = f"outcome={outcome} rc={rc} stderr_head={head!r}"

    # 10. Auto-PR (only on ok + real-edit + cwd + initial_sha known).
    pr_url: str | None = None
    auto_merge_enabled = False
    files_touched: int | None = None
    commits_made: int | None = None
    final_sha: str | None = None

    if (outcome == "ok"
            and auto_pr
            and cwd
            and initial_sha
            and branch
            and permission_mode != "plan"):
        det = detect_commits_made(cwd, initial_sha)
        if det.get("ok"):
            commits_made = det["count"]
            files_touched = det["files_touched"]
            final_sha = det["head"]
            if commits_made > 0:
                journal_event(spawn_id, "auto-pr-start",
                              f"branch={branch} commits={commits_made} files={files_touched}")
                # Ensure trailer on commits
                trailer_res = ensure_spawned_by_trailer(cwd, initial_sha)
                if not trailer_res.get("ok"):
                    journal_event(spawn_id, "auto-pr-trailer-warning",
                                  trailer_res.get("error", "")[:300])
                # Push
                push_res = push_branch(cwd, branch)
                if not push_res.get("ok"):
                    journal_event(spawn_id, "auto-pr-push-failed",
                                  push_res.get("error", "")[:300])
                else:
                    # Build PR title + body
                    title_seed = (task_spec.get("title")
                                  or task_id
                                  or "autonomous-loop change")
                    pr_title = f"[autonomous] {title_seed}"[:120]
                    pr_body = (
                        f"Auto-PR opened by the slot-manager autonomous loop.\n\n"
                        f"- spawn_id: `{spawn_id}`\n"
                        f"- task_id: `{task_id}`\n"
                        f"- bucket: `{bucket}`\n"
                        f"- host: `{HOST_NAME}`\n"
                        f"- permission_mode: `{permission_mode}`\n"
                        f"- risk_tier: `{risk_tier or 'low'}`\n"
                        f"- model: `{record.get('model') or 'unknown'}`\n"
                        f"- session_id: `{record.get('session_id') or 'n/a'}`\n"
                        f"- commits: {commits_made}\n"
                        f"- files_touched: {files_touched}\n"
                        f"- initial_sha: `{initial_sha[:10]}`\n"
                        f"- final_sha: `{final_sha[:10]}`\n\n"
                        f"This PR was created by Phase 5 of the slot-manager auto-PR pipeline.\n"
                        f"Auto-merge is gated on the standard required CI checks (DoD evidence-gate);\n"
                        f"high-risk specs ({{`risk_tier=high`}}) NEVER auto-merge.\n\n"
                        f"References:\n"
                        f"- [Slot Manager Phase 5 brief](agent-memory/slot_manager_phase5_brief.md)\n"
                        f"- [Definition of Done](agent-memory/feedback_definition_of_done.md)\n"
                        f"- [Zero-dollar rule](agent-memory/feedback_no_api_key_billing.md)\n\n"
                        f"{SPAWNED_BY_TRAILER}\n"
                    )
                    pr_res = create_pr(cwd, branch,
                                       DEFAULT_PR_BASE_BRANCH, pr_title, pr_body,
                                       [DEFAULT_PR_LABEL])
                    if pr_res.get("ok"):
                        pr_url = pr_res["url"]
                        journal_event(spawn_id, "auto-pr-opened",
                                      f"url={pr_url}")
                        # Auto-merge?
                        if auto_merge and (risk_tier or "low") != "high":
                            am = enable_auto_merge(cwd, pr_url)
                            if am.get("ok"):
                                auto_merge_enabled = True
                                journal_event(spawn_id, "auto-pr-auto-merge-enabled", pr_url)
                            else:
                                journal_event(spawn_id, "auto-pr-auto-merge-failed",
                                              am.get("error", "")[:300])
                    else:
                        journal_event(spawn_id, "auto-pr-create-failed",
                                      pr_res.get("error", "")[:300])
            else:
                journal_event(spawn_id, "auto-pr-skipped-no-commits",
                              f"branch={branch} clean")
        else:
            journal_event(spawn_id, "auto-pr-detect-failed",
                          det.get("error", "")[:300])

    # 11. Phase 6: tear down the per-spawn worktree no matter what the
    #     outcome was. Branch lives on origin via the auto-PR push above
    #     (if commits were made); the local working dir is scratch.
    worktree_cleanup_status: str | None = None
    if worktree_used and worktree_path and repo_root:
        cw_res = cleanup_worktree(repo_root, worktree_path)
        if cw_res.get("ok"):
            worktree_cleanup_status = "ok"
            journal_event(spawn_id, "worktree-cleaned",
                          f"path={worktree_path}")
        else:
            worktree_cleanup_status = f"failed: {cw_res.get('error', '')[:200]}"
            journal_event(spawn_id, "worktree-cleanup-failed",
                          f"path={worktree_path} err={cw_res.get('error', '')[:200]}")

    journal_finalize(spawn_id, outcome,
                     duration_ms=duration_ms,
                     exit_code=rc,
                     session_id=record["session_id"],
                     model=record["model"],
                     binary_path=bp, binary_sha256=sha,
                     error=error_field,
                     final_sha=final_sha,
                     files_touched=files_touched,
                     commits_made=commits_made,
                     pr_url=pr_url,
                     auto_merge_enabled=auto_merge_enabled,
                     # LAI phase 7 telemetry: this spawn went to claude
                     # (we'd have returned early in the router-gate block
                     # otherwise), so claude_invoked=True.
                     claude_invoked=True,
                     router_tier=router_decision.get("tier"),
                     router_intent=router_decision.get("intent"),
                     router_confidence=router_decision.get("confidence"),
                     optimizer_backend=optimizer_meta.get("backend"),
                     optimizer_pre_tokens=optimizer_meta.get("pre_token_count"),
                     optimizer_post_tokens=optimizer_meta.get("post_token_count"),
                     optimizer_compression=optimizer_meta.get("compression_ratio"),
                     optimizer_stages_run=optimizer_meta.get("stages_run"),
                     optimizer_wall_ms=optimizer_meta.get("wall_ms"),
                     optimizer_error=optimizer_meta.get("error"))
    # SPS-α telemetry: emit per-spawn substrate state as a journal event so the
    # displacement metric can distinguish wrapped/stabilized runs without
    # requiring a schema migration on the claude_sessions table.
    journal_event(spawn_id, "claude-invocation-mode",
                  f"headroom_wrapped={record.get('headroom_wrapped', False)} "
                  f"prefix_stabilized={record.get('prefix_stabilized', False)}")
    journal_event(spawn_id, f"spawn-{outcome}",
                  f"rc={rc} dur_ms={duration_ms} session={record.get('session_id')} "
                  f"mode={permission_mode} commits={commits_made} pr={pr_url} "
                  f"worktree_cleanup={worktree_cleanup_status}")

    parsed = record.get("parsed") or {}
    log.info("spawn served: spawn_id=%s slot=%s bucket=%s task=%s outcome=%s rc=%s "
             "sha=%s session=%s model=%s dur_ms=%d mode=%s commits=%s pr=%s",
             spawn_id, slot_id, bucket, task_id, outcome, rc, sha[:16],
             (record.get("session_id") or "")[:8], record.get("model"),
             duration_ms, permission_mode, commits_made, pr_url)

    body = {
        "ok":                outcome == "ok",
        "outcome":           outcome,
        "exit_code":         rc,
        "rc":                rc,
        "subscription_only": True,
        "binary_path":       bp,
        "binary_sha256":     sha,
        "session_id":        record["session_id"],
        "model":             record["model"],
        "duration_ms":       duration_ms,
        "spawn_id":          spawn_id,
        "ack":               {"task_id": task_id, "ready": True},
        "host_name":         HOST_NAME,
        "parsed":            parsed,
        "error":             error_field,
        # Phase 5 fields:
        "permission_mode":   permission_mode,
        "allow_list":        accepted_paths,
        "risk_tier":         risk_tier,
        "cwd":               cwd,
        "initial_sha":       initial_sha,
        "final_sha":         final_sha,
        "branch":            branch,
        "files_touched":     files_touched,
        "commits_made":      commits_made,
        "pr_url":            pr_url,
        "auto_merge_enabled": auto_merge_enabled,
        # Phase 6 fields:
        "worktree_used":     worktree_used,
        "worktree_path":     worktree_path,
        "worktree_cleanup":  worktree_cleanup_status,
        "repo_root":         repo_root,
    }
    return JSONResponse(status_code=200, content=body)


# --- Admin / introspection -------------------------------------------------

@app.get("/admin/sessions")
def list_sessions(limit: int = 50, status: str | None = None):
    sql = "SELECT * FROM claude_sessions"
    args: list[Any] = []
    if status:
        sql += " WHERE status=?"
        args.append(status)
    sql += " ORDER BY started_at DESC LIMIT ?"
    args.append(limit)
    with _db_lock:
        rows = db().execute(sql, args).fetchall()
    return {"sessions": [dict(r) for r in rows]}


@app.get("/admin/sessions/{spawn_id}")
def get_session(spawn_id: str):
    row = journal_lookup(spawn_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


@app.get("/admin/events")
def list_events(limit: int = 100, spawn_id: str | None = None):
    sql = "SELECT * FROM spawner_events"
    args: list[Any] = []
    if spawn_id:
        sql += " WHERE spawn_id=?"
        args.append(spawn_id)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with _db_lock:
        rows = db().execute(sql, args).fetchall()
    return {"events": [dict(r) for r in rows]}


@app.get("/metrics", response_class=PlainTextResponse)
def metrics():
    with _db_lock:
        rows = db().execute(
            "SELECT status, COUNT(*) AS c FROM claude_sessions GROUP BY status"
        ).fetchall()
        mode_rows = db().execute(
            "SELECT permission_mode, COUNT(*) AS c FROM claude_sessions "
            "WHERE permission_mode IS NOT NULL GROUP BY permission_mode"
        ).fetchall()
        pr_rows = db().execute(
            "SELECT COUNT(*) AS c FROM claude_sessions WHERE pr_url IS NOT NULL"
        ).fetchall()
    lines = [
        "# HELP claude_spawner_sessions_total claude_sessions rows by status",
        "# TYPE claude_spawner_sessions_total counter",
    ]
    for r in rows:
        lines.append(f'claude_spawner_sessions_total{{status="{r["status"]}"}} {r["c"]}')
    lines += [
        "# HELP claude_spawner_sessions_by_mode_total claude_sessions rows by permission_mode",
        "# TYPE claude_spawner_sessions_by_mode_total counter",
    ]
    for r in mode_rows:
        lines.append(f'claude_spawner_sessions_by_mode_total{{mode="{r["permission_mode"]}"}} {r["c"]}')
    lines += [
        "# HELP claude_spawner_auto_prs_total claude_sessions that produced an auto-PR",
        "# TYPE claude_spawner_auto_prs_total counter",
        f'claude_spawner_auto_prs_total {pr_rows[0]["c"] if pr_rows else 0}',
    ]
    bp, sha = binary_path_and_sha256()
    lines += [
        "# HELP claude_spawner_subscription_only 1 if guard passing",
        "# TYPE claude_spawner_subscription_only gauge",
        f"claude_spawner_subscription_only 1" if subscription_guard_message() is None
        else "claude_spawner_subscription_only 0",
        f'claude_spawner_info{{version="{VERSION}",host_name="{HOST_NAME}",binary_sha256="{sha[:16]}"}} 1',
    ]
    return "\n".join(lines) + "\n"


# --- Main ------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "claude_spawner_agent:app",
        host="0.0.0.0",
        port=PORT,
        log_level=LOG_LEVEL.lower(),
        access_log=True,
    )
