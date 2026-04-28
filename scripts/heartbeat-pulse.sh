#!/bin/bash
# Conductor heartbeat pulse runner. Invoked by launchd every 15 min.
# Routes pulse outcome -> pulse_runs DB row + macOS notification + system.warning event.

set -u
PULSE_CLI="$HOME/Documents/projects/conductor/dist/src/cli/index.js"
LOG="$HOME/Library/Logs/conductor-heartbeat-pulse.log"
RAW="/tmp/conductor-pulse-last.json"
TS_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$(dirname "$LOG")"
echo "[$TS_ISO] pulse starting" >> "$LOG"

# Run pulse — keep output for parser
NODE_BIN=""
for cand in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$cand" ] && NODE_BIN="$cand" && break
done
if [ -z "$NODE_BIN" ]; then
    echo "[$TS_ISO] node binary not found" >> "$LOG"
    : > "$RAW"
elif ! "$NODE_BIN" "$PULSE_CLI" pulse --json > "$RAW" 2>>"$LOG"; then
    echo "[$TS_ISO] pulse exited non-zero" >> "$LOG"
fi

# Single python invocation does parse + DB write + notification
python3 - "$RAW" "$TS_ISO" >> "$LOG" 2>&1 <<'PYINNER'
import json, sqlite3, os, sys, subprocess, time

raw_path, ts_iso = sys.argv[1], sys.argv[2]
db = os.path.expanduser("~/.conductor/db.sqlite")

try:
    raw = open(raw_path).read()
    j = json.loads(raw)
    run_id = j.get("runId") or f"pulse_local_{int(time.time())}"
    ran_at = j.get("ranAt") or ts_iso
    outcome = j.get("outcome", "UNKNOWN")
    dur = int(j.get("durationMs") or 0)
except Exception as e:
    raw = ""
    run_id = f"pulse_parse_err_{int(time.time())}"
    ran_at = ts_iso
    outcome = "PARSE_ERROR"
    dur = 0
    print(f"parse error: {e}")

conn = sqlite3.connect(db)
cur = conn.cursor()
cur.execute(
    """INSERT OR REPLACE INTO pulse_runs(run_id, ran_at, outcome, duration_ms,
       triggered_by, raw_json, notes) VALUES (?,?,?,?,?,?,?)""",
    (run_id, ran_at, outcome, dur, "heartbeat-pulse-launchd", raw[:200000], None),
)

if outcome in ("DEGRADED", "CRITICAL", "PARSE_ERROR"):
    evt_id = f"evt_pulse_{run_id}"
    sev = "critical" if outcome == "CRITICAL" else "warning"
    cur.execute(
        """INSERT OR IGNORE INTO events(id, type, occurred_at, actor, entity_type,
           entity_id, payload_json, severity) VALUES (?,?,?,?,?,?,?,?)""",
        (evt_id, "system.warning", ran_at, "heartbeat-pulse-launchd",
         "pulse_run", run_id,
         json.dumps({"outcome": outcome, "run_id": run_id}), sev),
    )
    subprocess.run([
        "osascript","-e",
        f'display notification "Pulse {outcome} ({run_id})" with title "Conductor Pulse" sound name "Submarine"'
    ], check=False)
elif outcome == "AUTO_HEALED":
    cnt = cur.execute(
        "SELECT COUNT(*) FROM pulse_runs WHERE ran_at > datetime('now','-24 hours')"
    ).fetchone()[0]
    if cnt == 1:
        subprocess.run([
            "osascript","-e",
            f'display notification "AUTO_HEALED — first in 24h ({run_id})" with title "Conductor Pulse"'
        ], check=False)

conn.commit()
conn.close()
print(f"OK outcome={outcome} run_id={run_id}")
PYINNER

echo "[$TS_ISO] pulse done" >> "$LOG"
