#!/usr/bin/env python3
"""
extract-prompts.py — One-time sweep to recover every user prompt from prior
Claude Cowork dispatch sessions and produce a deduplicated chronological list
formatted for Phase 1 backlog ingestion.

Source: ~/Library/Application Support/Claude/local-agent-mode-sessions/<topUUID>/<subUUID>/local_<sessionId>/audit.jsonl

Each line in audit.jsonl is a JSON record with at least:
  type            : 'user' | 'assistant' | 'system' | 'rate_limit_event' | 'result'
  uuid            : record id
  session_id      : session uuid (matches dir)
  parent_tool_use_id : non-null when the user record is actually a tool result
  message         : { role, content }
    content is either a string (real or system-injected user text) or a list
    (tool_result blocks).
  _audit_timestamp : ISO 8601 UTC string

A "real" Prakash prompt is:
  type=='user' AND message.role=='user' AND content is a non-empty string
  AND content does NOT start with one of the system-injected XML-like tags
  (<scheduled-task>, <system-reminder>, <command-message>, <command-name>,
   <local-command-stdout>, <local-command-stderr>, <bash-input>, ...)
  AND content does NOT match an auto-generated notification pattern (e.g.
   "Scheduled task X completed/failed its run...")
  AND parent_tool_use_id is null.

Dedup: voice-to-text retries land as near-identical text within ~5–15 seconds.
Group prompts with the same SESSION and same first-N-char prefix that fall
within DEDUP_WINDOW_SECONDS of each other; keep the longest variant.

Classification per mission spec:
  EXECUTE       : urgency markers (URGENT, ASAP, drop everything, critical, NOW, immediately)
  ANALYZE       : strategic/architectural/future-state language
  CONVERSATION  : direct question / single-line clarification
  BACKLOG       : everything else (concrete TODO without urgency markers)

Tags auto-extracted from text:
  - project: best-effort match on known project keywords
  - urgency: any urgency keyword present

Run:
  python3 extract-prompts.py [--out PATH] [--sessions DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------- Config ---------------------------------------------------------

DEFAULT_SESSIONS_DIR = Path(
    "/Users/MAC/Library/Application Support/Claude/local-agent-mode-sessions"
)
DEFAULT_OUT = Path(
    "/Users/MAC/Documents/projects/reports/prompt-backlog-2026-04-28.md"
)

DEDUP_PREFIX_CHARS = 256
DEDUP_WINDOW_SECONDS = 60

SYSTEM_PREFIXES = (
    "<scheduled-task",
    "<system-reminder",
    "<command-message",
    "<command-name",
    "<local-command-stdout",
    "<local-command-stderr",
    "<bash-input",
    "<bash-stdout",
    "<bash-stderr",
)

# Auto-generated notifications that travel via the user channel but are not
# Prakash-typed. Most common: completion/failure pings for scheduled tasks
# delivered to the orchestrator (ditto_) sessions.
AUTO_NOTIFICATION_PATTERNS = (
    re.compile(r'^Scheduled task ".+?" (completed|failed) its run\b'),
)

URGENCY_WORDS = [
    "URGENT", "ASAP", "DROP EVERYTHING", "CRITICAL", "IMMEDIATELY",
    "RIGHT NOW", "EMERGENCY", "BLOCKER", "P0",
]

ANALYZE_HINTS = [
    "strategy", "strategic", "architecture", "architectural", "long-term",
    "future-state", "future state", "vision", "roadmap", "trade-off",
    "tradeoff", "should we", "evaluate", "assess", "analyze", "analyse",
    "options for", "approach to", "design doc", "rfc",
]

# Project keyword map. Order matters — first match wins.
PROJECT_KEYWORDS = [
    ("roulette-community",   ["roulettecommunity", "roulette community", "roulette-community"]),
    ("poker-zeno",           ["pokerzeno", "poker zeno", "poker-zeno"]),
    ("caia",                 [" caia ", "caia/", "caia.", "caia,", "caia executor", "caia dashboard", "caia monorepo", "caia pipeline"]),
    ("conductor",            ["conductor"]),
    ("stolution",            ["stolution"]),
    ("bjana",                ["bjana"]),
    ("seo-program",          ["seo-program", "seo program"]),
    ("content-engine",       ["content-engine", "content engine"]),
    ("dashboard",            ["dashboard"]),
    ("dispatch-pipeline",    ["dispatch", "phase 1 pipeline", "pipeline phase 1"]),
    ("integrity-check",      ["integrity-check", "integrity check"]),
    ("backend-core",         ["backend-core", "backend core"]),
    ("framework",            ["framework"]),
]

# ---------- Helpers --------------------------------------------------------

def parse_ts(s):
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except Exception:
        return None


def is_real_prompt(record):
    if record.get("type") != "user":
        return False, None
    if record.get("parent_tool_use_id"):
        return False, "tool_result"
    msg = record.get("message") or {}
    if msg.get("role") != "user":
        return False, "non_user_role"
    content = msg.get("content")
    if not isinstance(content, str):
        return False, "non_string_content"
    stripped = content.lstrip()
    if not stripped:
        return False, "empty"
    for prefix in SYSTEM_PREFIXES:
        if stripped.startswith(prefix):
            return False, f"system_prefix:{prefix}"
    for pat in AUTO_NOTIFICATION_PATTERNS:
        if pat.match(stripped):
            return False, "auto_notification"
    return True, None


def classify(text):
    upper = text.upper()
    for w in URGENCY_WORDS:
        if w in upper:
            return "EXECUTE"
    lower = text.lower()
    for hint in ANALYZE_HINTS:
        if hint in lower:
            return "ANALYZE"
    one_line = text.strip().splitlines()
    if len(one_line) == 1 and len(one_line[0]) < 240 and one_line[0].rstrip().endswith("?"):
        return "CONVERSATION"
    return "BACKLOG"


def extract_tags(text):
    tags = []
    lower = " " + text.lower() + " "
    seen = set()
    for tag, kws in PROJECT_KEYWORDS:
        for kw in kws:
            if kw.lower() in lower and tag not in seen:
                tags.append(f"project:{tag}")
                seen.add(tag)
                break
    upper = text.upper()
    for w in URGENCY_WORDS:
        if w in upper:
            tags.append(f"urgency:{w.lower().replace(' ', '-')}")
    return tags


def session_id_from_path(audit_path):
    parent = audit_path.parent.name  # local_<sessionId>
    return parent[len("local_"):] if parent.startswith("local_") else parent


# ---------- Walk -----------------------------------------------------------

def collect_prompts(sessions_dir):
    audit_files = list(sessions_dir.rglob("audit.jsonl"))
    sessions_scanned = len(audit_files)
    sessions_with_real = 0
    prompts = []
    skipped_reasons = {}
    for path in audit_files:
        sid = session_id_from_path(path)
        had_real = False
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ok, reason = is_real_prompt(rec)
                    if not ok:
                        if reason and rec.get("type") == "user":
                            skipped_reasons[reason] = skipped_reasons.get(reason, 0) + 1
                        continue
                    text = rec["message"]["content"]
                    ts = parse_ts(rec.get("_audit_timestamp"))
                    prompts.append({
                        "session_id": sid,
                        "ts": ts,
                        "ts_raw": rec.get("_audit_timestamp"),
                        "uuid": rec.get("uuid"),
                        "text": text,
                    })
                    had_real = True
        except (OSError, IOError) as e:
            print(f"WARN: cannot read {path}: {e}", file=sys.stderr)
        if had_real:
            sessions_with_real += 1
    return prompts, sessions_scanned, sessions_with_real, skipped_reasons


# ---------- Dedup ----------------------------------------------------------

def dedup(prompts):
    prompts_sorted = sorted(
        prompts,
        key=lambda p: (p["session_id"], p["ts"] or datetime.min.replace(tzinfo=timezone.utc)),
    )
    kept = []
    for p in prompts_sorted:
        prefix = p["text"][:DEDUP_PREFIX_CHARS]
        merged = False
        for k in reversed(kept[-8:]):
            if k["session_id"] != p["session_id"]:
                continue
            if k["ts"] and p["ts"]:
                gap = abs((p["ts"] - k["ts"]).total_seconds())
                if gap > DEDUP_WINDOW_SECONDS:
                    continue
            if k["text"][:DEDUP_PREFIX_CHARS] != prefix:
                continue
            if len(p["text"]) > len(k["text"]):
                k["text"] = p["text"]
                k["ts"] = k["ts"] or p["ts"]
                k["ts_raw"] = k["ts_raw"] or p["ts_raw"]
            merged = True
            break
        if not merged:
            kept.append(dict(p))
    kept.sort(key=lambda p: p["ts"] or datetime.min.replace(tzinfo=timezone.utc))
    return kept


# ---------- Render ---------------------------------------------------------

def render_markdown(prompts, stats):
    lines = []
    A = lines.append
    A("# Prompt Backlog — Recovered from Prior Cowork Sessions")
    A("")
    A(f"_Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}_")
    A("")
    A("Seed input for Phase 1 dispatch pipeline. Each entry is a verbatim user")
    A("prompt extracted from `audit.jsonl` transcripts. Replies from Claude are")
    A("not included. Auto-classification per the heuristics in")
    A("`feedback_prompts_as_backlog.md`.")
    A("")
    A("## Summary")
    A("")
    A(f"- Sessions scanned: **{stats['sessions_scanned']}**")
    A(f"- Sessions with at least one real user prompt: **{stats['sessions_with_real']}**")
    A(f"- Raw user prompts extracted: **{stats['raw_prompts']}**")
    A(f"- After dedup (window {DEDUP_WINDOW_SECONDS}s, prefix {DEDUP_PREFIX_CHARS} chars): **{stats['deduped']}**")
    A("")
    A("### Skipped (filtered as non-prompts)")
    A("")
    for reason, n in sorted(stats["skipped"].items(), key=lambda x: -x[1]):
        A(f"- {reason}: {n}")
    A("")
    A("### Classification breakdown")
    A("")
    for k in ("EXECUTE", "ANALYZE", "BACKLOG", "CONVERSATION"):
        A(f"- {k}: {stats['classes'].get(k, 0)}")
    A("")
    A("---")
    A("")
    A("## Prompts (chronological)")
    A("")
    for i, p in enumerate(prompts, 1):
        ts = p["ts_raw"] or "unknown"
        cls = p["_class"]
        tags = p["_tags"]
        A(f"### PB-{i}")
        A("")
        A(f"- **timestamp**: `{ts}`")
        A(f"- **session_id**: `{p['session_id']}`")
        A(f"- **classification**: {cls}")
        if tags:
            A(f"- **tags**: {', '.join(tags)}")
        else:
            A(f"- **tags**: _(none)_")
        A(f"- **chars**: {len(p['text'])}")
        A("")
        A("```text")
        A(p["text"].rstrip())
        A("```")
        A("")
    return "\n".join(lines) + "\n"


# ---------- Main -----------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=Path, default=DEFAULT_SESSIONS_DIR)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.sessions.is_dir():
        print(f"ERROR: sessions dir not found: {args.sessions}", file=sys.stderr)
        return 2

    prompts, sessions_scanned, sessions_with_real, skipped = collect_prompts(args.sessions)
    raw_count = len(prompts)
    deduped = dedup(prompts)

    classes = {}
    for p in deduped:
        p["_class"] = classify(p["text"])
        p["_tags"] = extract_tags(p["text"])
        classes[p["_class"]] = classes.get(p["_class"], 0) + 1

    stats = {
        "sessions_scanned": sessions_scanned,
        "sessions_with_real": sessions_with_real,
        "raw_prompts": raw_count,
        "deduped": len(deduped),
        "classes": classes,
        "skipped": skipped,
    }

    md = render_markdown(deduped, stats)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(md, encoding="utf-8")

    print(json.dumps(stats, indent=2))
    print(f"OUT: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
