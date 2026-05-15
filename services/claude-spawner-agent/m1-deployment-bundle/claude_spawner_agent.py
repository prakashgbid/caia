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


# --- Configuration ---------------------------------------------------------

VERSION       = "1.1.0-phase5"
PORT          = int(os.environ.get("PORT", "8090"))
HOST_NAME     = os.environ.get("HOST_NAME", "mac-m1")
CLAUDE_BINARY = os.environ.get("CLAUDE_BINARY", "/Users/MAC/.local/bin/claude")
LOG_LEVEL     = os.environ.get("LOG_LEVEL", "INFO").upper()
DB_PATH       = Path(os.environ.get(
    "SPAWNER_DB",
    str(Path.home() / ".cache/claude-spawner-agent/spawner.db")
))
DEFAULT_TIMEOUT_S = float(os.environ.get("DEFAULT_TIMEOUT_S", "120.0"))
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
        # Phase 5 idempotent migrations
        existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(claude_sessions)").fetchall()}
        for stmt in PHASE5_MIGRATIONS:
            col_name = stmt.split("ADD COLUMN ")[1].split()[0]
            if col_name in existing_cols:
                continue
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError as e:
                log.warning("phase5 migration %r skipped: %s", stmt, e)
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
                     auto_merge_enabled: bool = False) -> None:
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
            "  auto_merge_enabled=? "
            "WHERE spawn_id=?",
            (status, duration_ms, exit_code, session_id, model,
             binary_path, binary_sha256, error,
             final_sha, files_touched, commits_made, pr_url,
             1 if auto_merge_enabled else 0,
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


def prepare_branch_for_spawn(cwd: str, task_id: str, spawn_id: str) -> dict[str, Any]:
    """Create + checkout a fresh branch from the current HEAD.

    If the working tree is dirty, abort — we won't drag uncommitted state
    into an autonomous spawn. If we're already on a branch starting with
    `auto/`, reuse it.
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
    return {"ok": True, "sha": state["sha"], "branch": branch, "reused": False}


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

    # Build argv
    cmd = [
        CLAUDE_BINARY, "-p", prompt,
        "--output-format", "json",
        "--permission-mode", permission_mode,
    ]
    max_turns = PERMISSION_MODE_MAX_TURNS.get(permission_mode)
    if max_turns is not None:
        cmd += ["--max-turns", str(max_turns)]
    for p in allow_list:
        cmd += ["--add-dir", p]

    started = time.time()
    log.info("spawn_id=%s mode=%s allow_list=%d cwd=%s invoking claude...",
             spawn_id, permission_mode, len(allow_list), cwd or "<inherit>")

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
    log.info("claude --version: %s", claude_version_str())
    binary_path_and_sha256()
    journal_event(None, "startup", f"version={VERSION} host={HOST_NAME}")

    try:
        reconcile_inflight()
    except Exception as e:
        log.exception("reconciliation failed: %s", e)

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

    # 5. If real-edit mode AND cwd provided, prepare branch + capture HEAD.
    initial_sha: str | None = None
    branch: str | None = None
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
        journal_event(spawn_id, "branch-prepared",
                      f"branch={branch} initial_sha={initial_sha[:10]} reused={prep.get('reused')}")

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
                     auto_merge_enabled=auto_merge_enabled)
    journal_event(spawn_id, f"spawn-{outcome}",
                  f"rc={rc} dur_ms={duration_ms} session={record.get('session_id')} "
                  f"mode={permission_mode} commits={commits_made} pr={pr_url}")

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
