#!/usr/bin/env python3
"""
SPS DAG auto-reload watcher.

Watches the canonical backlog markdown files in ~/Documents/projects/agent-memory,
detects content changes via sha256, and POSTs the changed file's text to
SPS /reload?purge=false (merge mode — leaves in-flight nodes alone, only
upserts titles/buckets/scope_tag/priority and inserts new rows).

Transport: SSH to stolution host -> curl into SPS ClusterIP. Re-resolves the
ClusterIP at every invocation (Phase 2 memo notes it's stable but rollout-
sensitive).

State:   ~/.cache/sps-reload-watcher/state.json   { "<abs_path>": "<sha256>" }
Log:     ~/Library/Logs/sps-reload-watcher.log    one JSON line per invocation
Files:
  ~/Documents/projects/agent-memory/master_backlog_sequencing_2026-05-05.md
  ~/Documents/projects/agent-memory/backlog_reconciliation_2026-05-09.md
  ~/Documents/projects/agent-memory/*_brief.md

Exit codes:
  0  no change OR successful reload(s)
  2  reload had errors (some files failed) — state.json updated only for OK
  3  fatal (config / IO / SSH unreachable)
"""

from __future__ import annotations
import glob
import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────────
HOME           = Path(os.path.expanduser("~"))
MEMORY_DIR     = HOME / "Documents/projects/agent-memory"
PRIMARY_FILES  = [
    MEMORY_DIR / "master_backlog_sequencing_2026-05-05.md",
    MEMORY_DIR / "backlog_reconciliation_2026-05-09.md",
]
BRIEF_GLOB     = str(MEMORY_DIR / "*_brief.md")

STATE_DIR      = HOME / ".cache/sps-reload-watcher"
STATE_FILE     = STATE_DIR / "state.json"

LOG_DIR        = HOME / "Library/Logs"
LOG_FILE       = LOG_DIR / "sps-reload-watcher.log"

SSH_ALIAS      = os.environ.get("SPS_SSH_ALIAS", "stolution")
SPS_NAMESPACE  = os.environ.get("SPS_NAMESPACE", "caia-orchestrator")
SPS_SERVICE    = os.environ.get("SPS_SERVICE", "sps")
SPS_PORT       = int(os.environ.get("SPS_PORT", "8080"))

# Settle delay: re-hash after this many seconds; reload only if sha unchanged.
# Guards against partial writes / Syncthing replication mid-flight.
SETTLE_SECS    = float(os.environ.get("SPS_SETTLE_SECS", "2.0"))
SSH_TIMEOUT    = int(os.environ.get("SPS_SSH_TIMEOUT", "20"))


# ─── Helpers ──────────────────────────────────────────────────────────────
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_event(payload: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"ts": now_iso(), **payload}
    with LOG_FILE.open("a") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(STATE_FILE)


def candidate_files() -> list[Path]:
    files: list[Path] = []
    for p in PRIMARY_FILES:
        if p.exists():
            files.append(p)
    files.extend(sorted(Path(p) for p in glob.glob(BRIEF_GLOB) if Path(p).is_file()))
    # Dedupe while preserving order.
    seen = set()
    uniq = []
    for p in files:
        ap = p.resolve()
        if ap in seen:
            continue
        seen.add(ap)
        uniq.append(ap)
    return uniq


def settled_sha(path: Path) -> str | None:
    """Return sha if two reads SETTLE_SECS apart agree; else None."""
    try:
        s1 = sha256_of(path)
    except FileNotFoundError:
        return None
    time.sleep(SETTLE_SECS)
    try:
        s2 = sha256_of(path)
    except FileNotFoundError:
        return None
    return s1 if s1 == s2 else None


def post_reload(path: Path) -> tuple[bool, dict | str]:
    """SSH to stolution, resolve SPS ClusterIP, POST /reload?purge=false."""
    try:
        text = path.read_text()
    except Exception as e:
        return False, f"read-failed: {e}"

    payload = json.dumps({
        "backlog_path": None,
        "inline_text":  text,
        "purge":        False,
    })

    # Remote shell:
    #   1) get the live ClusterIP
    #   2) curl /reload with stdin payload
    remote_cmd = (
        "set -eo pipefail; "
        f"SPS_IP=$(kubectl -n {shlex.quote(SPS_NAMESPACE)} "
        f"get svc {shlex.quote(SPS_SERVICE)} -o jsonpath='{{.spec.clusterIP}}'); "
        f"if [ -z \"$SPS_IP\" ]; then echo SPS_IP_RESOLVE_FAILED >&2; exit 7; fi; "
        f"curl -fsS --max-time 15 -X POST "
        f"-H 'Content-Type: application/json' "
        f"http://$SPS_IP:{SPS_PORT}/reload "
        "--data-binary @-"
    )
    cmd = ["ssh",
           "-o", "BatchMode=yes",
           "-o", f"ConnectTimeout={SSH_TIMEOUT}",
           SSH_ALIAS, remote_cmd]
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 30,
        )
    except subprocess.TimeoutExpired:
        return False, "ssh-timeout"
    except Exception as e:
        return False, f"ssh-exec-failed: {e}"

    if proc.returncode != 0:
        return False, {
            "rc":     proc.returncode,
            "stderr": proc.stderr.strip()[:1000],
            "stdout": proc.stdout.strip()[:1000],
        }
    try:
        body = json.loads(proc.stdout or "{}")
    except Exception:
        body = {"raw": proc.stdout.strip()[:1000]}
    return bool(body.get("ok")) if isinstance(body, dict) else False, body


# ─── Main ─────────────────────────────────────────────────────────────────
def main() -> int:
    files = candidate_files()
    if not files:
        log_event({"event": "no-files", "memory_dir": str(MEMORY_DIR)})
        return 0

    state = load_state()

    # Discover changes.
    changed: list[tuple[Path, str]] = []   # (path, new_sha)
    skipped_unsettled: list[str] = []
    for path in files:
        new_sha = settled_sha(path)
        if new_sha is None:
            skipped_unsettled.append(str(path))
            continue
        old_sha = state.get(str(path))
        if old_sha != new_sha:
            changed.append((path, new_sha))

    if not changed and not skipped_unsettled:
        log_event({"event": "no-change", "files_checked": len(files)})
        return 0

    if not changed:
        log_event({
            "event":             "skipped-unsettled-only",
            "files_checked":     len(files),
            "unsettled":         skipped_unsettled,
        })
        return 0

    # POST one /reload per changed file. Update state per success.
    results = []
    any_failed = False
    for path, new_sha in changed:
        ok, body = post_reload(path)
        result = {
            "file": str(path),
            "ok":   ok,
            "sha":  new_sha[:12],
            "body": body,
        }
        results.append(result)
        if ok:
            state[str(path)] = new_sha
        else:
            any_failed = True

    save_state(state)
    log_event({
        "event":     "reloaded",
        "changed":   len(changed),
        "unsettled": skipped_unsettled,
        "results":   results,
    })
    return 2 if any_failed else 0


if __name__ == "__main__":
    try:
        rc = main()
    except Exception as e:
        log_event({"event": "fatal", "error": str(e)})
        rc = 3
    sys.exit(rc)
