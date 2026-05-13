#!/usr/bin/env python3
# =============================================================================
# audit_recent_done — hourly self-audit feedback loop (B15.E)
# =============================================================================
# Re-scores `done` nodes from the last 1h against the 10-stage Definition-of-
# Done methodology and writes the result to `reliability_rolling`.  Items
# scoring <=2 are dispatched into the B14.J `re-decompose` queue.
#
# This script is a deterministic local scorer over DB rows — it does NOT
# spawn `claude` or call any LLM.  All of the heuristics live in
# `score_node()` below and follow `completion_audit_methodology_2026-05-10.md`.
#
# Cron contract (com.chiefaia.sps-audit-recent-done-hourly):
#   * Runs at minute 0 of every hour.
#   * Audits the bucket [previous-hour-start, previous-hour-end) — i.e. the
#     hour that JUST closed, not the in-progress hour.
#   * Idempotent: re-running for an existing bucket UPSERTs the row.
#   * Writes one row to reliability_rolling, plus N rows to redecompose_queue
#     (one per score≤2 node), all in a single transaction.
#   * On bucket reliability < 95% (or threshold flip vs prior bucket), appends
#     a structured alert line to ~/Documents/projects/agent-memory/INBOX.md.
#
# Exit codes:
#   0 — audit completed (bucket may be empty; that's not an error).
#   1 — DB unavailable / schema missing.
#   2 — audit ran but the alert append failed (caller may want to retry).
#
# Usage:
#   audit_recent_done.py                    # audit prev hour, write to live DB
#   audit_recent_done.py --bucket 2026-05-13T02:00:00Z   # audit specific bucket
#   audit_recent_done.py --db /tmp/x.db --inbox /tmp/y.md   # ephemeral test mode
#   audit_recent_done.py --dry-run          # print summary, do not write
#
# Authoritative refs:
#   ~/Documents/projects/agent-memory/completion_audit_methodology_2026-05-10.md
#   ~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md §6.6-6.8
#   ~/Documents/projects/agent-memory/scope_pipeline_unification_2026-05-10.md §[12]
# =============================================================================
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ---- Constants --------------------------------------------------------------

RELIABILITY_THRESHOLD_PCT = 95.0          # design §6.6: alert below this
MAX_REDECOMPOSE_DEPTH      = 3            # design §[12]: bounded recursion
SYNTHETIC_NODE_PREFIXES    = ('test::',)  # methodology §4 Class D — exclude

DEFAULT_DB    = Path.home() / '.sps' / 'sps.db'
DEFAULT_INBOX = Path.home() / 'Documents' / 'projects' / 'agent-memory' / 'INBOX.md'

# ---- Bucket helpers ---------------------------------------------------------

def previous_hour_bucket(now: datetime | None = None) -> tuple[str, str]:
    """Return (bucket_start, bucket_end) ISO-8601 UTC strings for the hour
    that just closed (i.e. one hour before `now` rounded down to the hour)."""
    now = now or datetime.now(tz=timezone.utc)
    end = now.replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(hours=1)
    iso = lambda dt: dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    return iso(start), iso(end)


def parse_bucket(bucket_start: str) -> tuple[str, str]:
    """Given an ISO-8601 bucket_start, return (bucket_start, bucket_end)
    where bucket_end = bucket_start + 1h."""
    dt = datetime.strptime(bucket_start, '%Y-%m-%dT%H:%M:%SZ').replace(
        tzinfo=timezone.utc)
    end = dt + timedelta(hours=1)
    return bucket_start, end.strftime('%Y-%m-%dT%H:%M:%SZ')


# ---- Scoring ----------------------------------------------------------------

def is_synthetic(node_id: str) -> bool:
    return any(node_id.startswith(p) for p in SYNTHETIC_NODE_PREFIXES)


def score_node(row: dict[str, Any]) -> tuple[int, str]:
    """Apply the 0-5 rubric to one row.  Returns (score, reason).

    Methodology §2 mapping (deterministic over DB columns — the rubric's
    `code shipped`, `tests`, `regression`, `documentation` heuristics are
    proxied by the evidence columns added in B15.C):

      * pr_url IS NULL                            → score 0 (false-claim)
      * pr_url present but no pr_merge_sha        → score 1 (verify-noop)
      * verifier_verdict_json overall != 'pass'   → score 1 (failed verdict)
      * dod_stages_evidenced character count vs required:
          0/10 → 0 ; 1-3/10 → 1 ; 4-5/10 → 2 ; 6-7/10 → 3 ; 8-9/10 → 4 ; 10/10 → 5
      * regression_check_result != 'pass'         → cap at 4
      * No regression_check_sha                   → cap at 3
    """
    pr_url           = row.get('pr_url')
    pr_merge_sha     = row.get('pr_merge_sha')
    vv_json          = row.get('verifier_verdict_json')
    dod_required     = row.get('dod_stages_required') or ''
    dod_evidenced    = row.get('dod_stages_evidenced') or ''
    regr_result      = row.get('regression_check_result')
    regr_sha         = row.get('regression_check_sha')

    if not pr_url:
        return 0, 'no pr_url — false-claim per methodology §2 score-0 rule'
    if not pr_merge_sha:
        return 1, 'pr_url present but no pr_merge_sha — verify-noop'
    if vv_json:
        try:
            vv = json.loads(vv_json)
            overall = (vv.get('overall') or '').lower()
            if overall and overall != 'pass':
                return 1, f'verifier verdict overall={overall!r}'
        except (json.JSONDecodeError, TypeError):
            pass

    stages_met = sum(1 for c in dod_evidenced if c == 'X')
    if not dod_evidenced:
        # No DoD self-cert at all but PR merged — base-line proves "Implement".
        # Treat as score-3 "real change, weak proof" (methodology §2).
        base_score = 3
        reason = 'pr merged but no dod self-cert — base-line proof only'
    elif stages_met == 10:
        base_score = 5
        reason = 'dod 10/10 stages evidenced'
    elif stages_met >= 8:
        base_score = 4
        reason = f'dod {stages_met}/10 stages evidenced'
    elif stages_met >= 6:
        base_score = 3
        reason = f'dod {stages_met}/10 stages evidenced'
    elif stages_met >= 4:
        base_score = 2
        reason = f'dod {stages_met}/10 stages evidenced — trivial-PR cap'
    elif stages_met >= 1:
        base_score = 1
        reason = f'dod {stages_met}/10 stages evidenced — verify-noop band'
    else:
        base_score = 0
        reason = 'dod 0/10 stages evidenced — false-claim'

    score = base_score
    if regr_result and regr_result != 'pass':
        score = min(score, 4)
        reason += f'; regression={regr_result} (capped 4)'
    elif not regr_sha:
        score = min(score, 3)
        reason += '; no regression_check_sha (capped 3)'

    return score, reason


# ---- DB I/O -----------------------------------------------------------------

NODE_COLUMNS = [
    'id', 'item_code', 'status', 'updated_at', 'scope_tag',
    'pr_url', 'pr_merge_sha',
    'verifier_verdict_json', 'verifier_feedback_json',
    'regression_check_sha', 'regression_check_result',
    'dod_stages_required', 'dod_stages_evidenced', 'dod_self_cert_json',
    'redecompose_attempt',
]


def _iso_to_sqlite(iso: str) -> str:
    """Convert 'YYYY-MM-DDTHH:MM:SSZ' to SQLite's 'YYYY-MM-DD HH:MM:SS'.
    nodes.updated_at uses the SQLite native (space-separated, no Z) format,
    so bucket boundary comparisons must match that or string ordering breaks
    (' ' < 'T' in ASCII)."""
    return iso.replace('T', ' ').rstrip('Z')


def fetch_done_in_bucket(conn: sqlite3.Connection,
                         bucket_start: str,
                         bucket_end: str) -> list[dict[str, Any]]:
    cols = ', '.join(NODE_COLUMNS)
    rows = conn.execute(
        f'SELECT {cols} FROM nodes '
        f"WHERE status = 'done' "
        f'  AND updated_at >= ? '
        f'  AND updated_at <  ? '
        f'ORDER BY updated_at ASC',
        (_iso_to_sqlite(bucket_start), _iso_to_sqlite(bucket_end)),
    ).fetchall()
    return [dict(zip(NODE_COLUMNS, r)) for r in rows]


def upsert_bucket_row(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    conn.execute(
        '''INSERT INTO reliability_rolling
              (bucket_start, bucket_end,
               nodes_audited, nodes_passing, nodes_score_le_2,
               nodes_score_3_to_4, nodes_score_5,
               reliability_pct, breached_threshold,
               audit_run_id, audit_started_at, audit_finished_at,
               audit_duration_ms, nodes_redecomposed_json, notes)
           VALUES (:bucket_start, :bucket_end,
                   :nodes_audited, :nodes_passing, :nodes_score_le_2,
                   :nodes_score_3_to_4, :nodes_score_5,
                   :reliability_pct, :breached_threshold,
                   :audit_run_id, :audit_started_at, :audit_finished_at,
                   :audit_duration_ms, :nodes_redecomposed_json, :notes)
           ON CONFLICT(bucket_start) DO UPDATE SET
               bucket_end              = excluded.bucket_end,
               nodes_audited           = excluded.nodes_audited,
               nodes_passing           = excluded.nodes_passing,
               nodes_score_le_2        = excluded.nodes_score_le_2,
               nodes_score_3_to_4      = excluded.nodes_score_3_to_4,
               nodes_score_5           = excluded.nodes_score_5,
               reliability_pct         = excluded.reliability_pct,
               breached_threshold      = excluded.breached_threshold,
               audit_run_id            = excluded.audit_run_id,
               audit_started_at        = excluded.audit_started_at,
               audit_finished_at       = excluded.audit_finished_at,
               audit_duration_ms       = excluded.audit_duration_ms,
               nodes_redecomposed_json = excluded.nodes_redecomposed_json,
               notes                   = excluded.notes
        ''', payload)


def insert_redecompose(conn: sqlite3.Connection,
                       node_id: str,
                       audit_score: int,
                       audit_reason: str,
                       audit_run_id: str,
                       audit_bucket: str,
                       depth: int) -> bool:
    if depth >= MAX_REDECOMPOSE_DEPTH:
        # Bounded by depth; escalate instead.
        next_action = 'operator-decision'
    else:
        next_action = 're-decompose'
    try:
        conn.execute(
            '''INSERT INTO redecompose_queue
                  (node_id, next_action, audit_score, audit_reason,
                   audit_run_id, audit_bucket, depth_at_queue)
               VALUES (?,?,?,?,?,?,?)''',
            (node_id, next_action, audit_score, audit_reason,
             audit_run_id, audit_bucket, depth),
        )
        return True
    except sqlite3.IntegrityError:
        # UNIQUE(node_id, audit_run_id) — already dispatched this run.
        return False


def previous_bucket_breached(conn: sqlite3.Connection,
                             bucket_start: str) -> bool | None:
    """Return the breached_threshold of the bucket immediately preceding
    bucket_start, or None if there is no prior bucket."""
    row = conn.execute(
        'SELECT breached_threshold FROM reliability_rolling '
        'WHERE bucket_start < ? ORDER BY bucket_start DESC LIMIT 1',
        (bucket_start,),
    ).fetchone()
    return bool(row[0]) if row else None


# ---- INBOX append -----------------------------------------------------------

def append_inbox_alert(inbox_path: Path,
                       bucket_start: str,
                       bucket_end: str,
                       reliability_pct: float | None,
                       nodes_audited: int,
                       nodes_score_le_2: int,
                       flip: str,
                       db_path: Path) -> None:
    """Append an INBOX alert per design §6.7.

    Format (single line, prefix-tagged so jq/grep can detect it):
        [B15.E reliability-alert] <ts> bucket=<start>/<end> rel=<pct>% audited=<N> score_le_2=<M> flip=<flip> db=<path>
    """
    ts = datetime.now(tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    rel = f'{reliability_pct:.2f}' if reliability_pct is not None else 'N/A'
    line = (
        f'\n[B15.E reliability-alert] ts={ts} '
        f'bucket={bucket_start}/{bucket_end} '
        f'rel={rel}% audited={nodes_audited} '
        f'score_le_2={nodes_score_le_2} flip={flip} '
        f'db={db_path} '
        f'(see reliability_rolling row for bucket_start={bucket_start})\n'
    )
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    with inbox_path.open('a', encoding='utf-8') as fh:
        fh.write(line)


# ---- Main -------------------------------------------------------------------

def run_audit(db_path: Path,
              inbox_path: Path,
              bucket_start: str | None = None,
              dry_run: bool = False) -> dict[str, Any]:
    if not db_path.exists():
        raise FileNotFoundError(f'SPS DB not found at {db_path}')

    bucket_start, bucket_end = (
        parse_bucket(bucket_start) if bucket_start else previous_hour_bucket()
    )

    started_at_iso = datetime.now(tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    started_at_mono = time.monotonic()
    audit_run_id = f'audit-{uuid.uuid4().hex[:12]}'

    conn = sqlite3.connect(str(db_path))
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        rows = fetch_done_in_bucket(conn, bucket_start, bucket_end)
        real_rows = [r for r in rows if not is_synthetic(r['id'])]

        nodes_audited      = len(real_rows)
        nodes_score_5      = 0
        nodes_score_3_to_4 = 0
        nodes_score_le_2   = 0
        redecomposed: list[dict[str, Any]] = []
        per_node_scores: list[dict[str, Any]] = []

        for r in real_rows:
            score, reason = score_node(r)
            per_node_scores.append({
                'node_id': r['id'], 'item_code': r['item_code'],
                'score': score, 'reason': reason,
            })
            if score == 5:
                nodes_score_5 += 1
            elif score >= 3:
                nodes_score_3_to_4 += 1
            else:
                nodes_score_le_2 += 1
                if not dry_run:
                    inserted = insert_redecompose(
                        conn, r['id'], score, reason,
                        audit_run_id, bucket_start,
                        int(r.get('redecompose_attempt') or 0),
                    )
                    if inserted:
                        redecomposed.append({
                            'node_id': r['id'], 'score': score,
                            'reason': reason,
                        })

        nodes_passing  = nodes_score_3_to_4 + nodes_score_5
        reliability_pct = (
            (nodes_passing / nodes_audited * 100.0) if nodes_audited else None
        )
        breached = bool(
            reliability_pct is not None and reliability_pct < RELIABILITY_THRESHOLD_PCT
        )

        finished_at_iso = datetime.now(tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        duration_ms = int((time.monotonic() - started_at_mono) * 1000)

        payload = {
            'bucket_start': bucket_start, 'bucket_end': bucket_end,
            'nodes_audited': nodes_audited,
            'nodes_passing': nodes_passing,
            'nodes_score_le_2': nodes_score_le_2,
            'nodes_score_3_to_4': nodes_score_3_to_4,
            'nodes_score_5': nodes_score_5,
            'reliability_pct': reliability_pct,
            'breached_threshold': 1 if breached else 0,
            'audit_run_id': audit_run_id,
            'audit_started_at': started_at_iso,
            'audit_finished_at': finished_at_iso,
            'audit_duration_ms': duration_ms,
            'nodes_redecomposed_json': json.dumps(redecomposed),
            'notes': None,
        }

        prior_breached = previous_bucket_breached(conn, bucket_start)
        flip = 'first' if prior_breached is None else (
            'flip-to-breach' if (breached and not prior_breached) else
            'flip-to-clear'  if (not breached and prior_breached) else
            ('still-breached' if breached else 'still-clear')
        )

        if not dry_run:
            upsert_bucket_row(conn, payload)
            conn.commit()

            if breached or flip == 'flip-to-breach':
                try:
                    append_inbox_alert(
                        inbox_path, bucket_start, bucket_end,
                        reliability_pct, nodes_audited,
                        nodes_score_le_2, flip, db_path,
                    )
                except OSError as exc:
                    return {'ok': False, 'inbox_error': str(exc), **payload,
                            'flip': flip, 'per_node_scores': per_node_scores}

        return {
            'ok': True, 'flip': flip,
            'per_node_scores': per_node_scores,
            'redecomposed': redecomposed,
            **payload,
        }
    finally:
        conn.close()


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description='Hourly self-audit of recent done nodes (B15.E)')
    p.add_argument('--db',     default=str(DEFAULT_DB),    help='SPS DB path')
    p.add_argument('--inbox',  default=str(DEFAULT_INBOX), help='INBOX.md path')
    p.add_argument('--bucket', default=None,
                   help='ISO-8601 bucket_start (default: previous closed hour)')
    p.add_argument('--dry-run', action='store_true',
                   help='Print summary but do not write to DB or INBOX')
    p.add_argument('--json', action='store_true',
                   help='Emit summary as JSON instead of human text')
    args = p.parse_args(argv)

    try:
        result = run_audit(Path(args.db), Path(args.inbox),
                           bucket_start=args.bucket, dry_run=args.dry_run)
    except FileNotFoundError as exc:
        print(f'ERR: {exc}', file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        rel = result['reliability_pct']
        rel_s = f'{rel:.2f}%' if rel is not None else 'N/A (empty bucket)'
        print(
            f"audit_run_id={result['audit_run_id']} "
            f"bucket={result['bucket_start']}/{result['bucket_end']}\n"
            f"  audited={result['nodes_audited']} "
            f"passing={result['nodes_passing']} "
            f"score_le_2={result['nodes_score_le_2']} "
            f"score_3_to_4={result['nodes_score_3_to_4']} "
            f"score_5={result['nodes_score_5']}\n"
            f"  reliability={rel_s} breached={bool(result['breached_threshold'])} "
            f"flip={result['flip']}\n"
            f"  redecomposed={len(result.get('redecomposed', []))} nodes "
            f"duration_ms={result['audit_duration_ms']}"
        )

    if not result.get('ok', True):
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
