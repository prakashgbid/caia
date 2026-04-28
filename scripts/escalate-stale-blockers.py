#!/usr/bin/env python3
"""Escalate stale blockers.

Runs hourly via launchd (com.conductor.escalate-stale-blockers).
Any open blocker with severity in (high, critical) older than 48h with
no events in the last 24h gets:
  - severity bumped to critical (if currently high)
  - resolution_note appended with "stale > 48h, escalated <ts>"
  - a system.warning event emitted to events table
"""
import os
import sqlite3
import json
import sys
from datetime import datetime, timezone, timedelta

DB = os.path.expanduser('~/.conductor/db.sqlite')


def main() -> int:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace('+00:00', 'Z')
    cutoff_48h = (now - timedelta(hours=48)).isoformat().replace('+00:00', 'Z')
    cutoff_24h = (now - timedelta(hours=24)).isoformat().replace('+00:00', 'Z')

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        """
        SELECT id, title, severity, created_at, resolution_note
        FROM blockers
        WHERE state='open'
          AND severity IN ('high','critical')
          AND created_at < ?
        """,
        (cutoff_48h,),
    )
    rows = cur.fetchall()

    bumped = 0
    for r in rows:
        cur.execute(
            "SELECT MAX(occurred_at) FROM events WHERE entity_type='blocker' AND entity_id=?",
            (r['id'],),
        )
        last_evt = cur.fetchone()[0]
        if last_evt and last_evt > cutoff_24h:
            continue

        new_sev = 'critical'
        note = (r['resolution_note'] or '').strip()
        suffix = f"stale > 48h, escalated {now_iso}"
        if suffix not in note:
            note = (note + ' | ' + suffix).strip(' |')

        if r['severity'] != new_sev or note != (r['resolution_note'] or ''):
            cur.execute(
                'UPDATE blockers SET severity=?, resolution_note=? WHERE id=?',
                (new_sev, note, r['id']),
            )
            bumped += 1

        evt_id = f"evt_escalate_{r['id']}_{int(now.timestamp())}"
        payload = json.dumps({
            'blocker_id': r['id'],
            'title': r['title'],
            'previous_severity': r['severity'],
            'new_severity': new_sev,
            'reason': 'stale > 48h with no events in 24h',
        })
        cur.execute(
            """INSERT OR IGNORE INTO events(id, type, occurred_at, actor, entity_type,
                   entity_id, payload_json, severity)
               VALUES (?,?,?,?,?,?,?,?)""",
            (evt_id, 'system.warning', now_iso, 'escalate-stale-blockers',
             'blocker', r['id'], payload, 'warning'),
        )

    conn.commit()
    conn.close()
    print(f'escalate-stale-blockers: scanned={len(rows)} bumped={bumped} at={now_iso}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
