#!/bin/zsh
# refresh-handoff.sh — canonical SESSION_HANDOFF.md refresher.
#
# Moved here from ~/.caia/handoff/refresh_handoff.sh in B4
# (integration-remediation-b phase 4, 2026-05-15). The path-portable script
# already used $HOME for every input — no behavioural change vs the original.
#
# Updates: freshness banner (incl. trigger reason + develop SHAs), Last
# updated line, chain state line, open PR list, active alerts pulled from
# active_alerts.jsonl.
#
# Usage:
#   refresh-handoff.sh                              # cron / default
#   refresh-handoff.sh --triggered-by <reason>      # event-triggered refresh
# >>> caia-plist-health-check-shim (phase A2)
case "${1:-}" in
  --health-check)
    # `date` is referenced by absolute path because the shim runs BEFORE
    # the host script's own PATH export — and the launchd-spawned env
    # inherits a minimal PATH that may not include /bin.
    printf '{"ok":true,"label":"%s","script":"%s","git_sha":"%s","pid":%d,"timestamp":"%s"}\n' \
      "${CAIA_PLIST_LABEL:-unknown}" "$0" "${CAIA_GIT_SHA:-unknown}" "$$" "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
    exit 0
    ;;
esac
# <<< caia-plist-health-check-shim

set -u
HANDOFF="$HOME/Documents/projects/agent-memory/SESSION_HANDOFF.md"
STATE="$HOME/.caia/chain/stability-completion/state.json"
[ -f "$HANDOFF" ] || exit 0

# --- Parse args ----------------------------------------------------------
TRIGGERED_BY="cron"
while [ $# -gt 0 ]; do
  case "$1" in
    --triggered-by)
      shift
      TRIGGERED_BY="${1:-cron}"
      ;;
    --triggered-by=*)
      TRIGGERED_BY="${1#--triggered-by=}"
      ;;
    *) ;;
  esac
  shift || true
done
# Strip newlines from reason; cap at 120 chars
TRIGGERED_BY=$(printf '%s' "$TRIGGERED_BY" | tr -d '\n\r' | cut -c1-120)
[ -z "$TRIGGERED_BY" ] && TRIGGERED_BY="cron"

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PAUSED=$(python3 -c "import json;d=json.load(open('$STATE'));print('PAUSED' if d.get('paused') else 'ACTIVE')" 2>/dev/null || echo "UNKNOWN")
PHASE=$(python3 -c "import json;d=json.load(open('$STATE'));print(d.get('current_phase','?'))" 2>/dev/null || echo "?")

# --- Capture latest develop SHAs (best-effort) ---------------------------
CAIA_SHA=$(gh api repos/prakashgbid/caia/commits/develop --jq '.sha[0:7]' 2>/dev/null || echo "unknown")
STOL_SHA=$(gh api repos/prakashgbid/stolution/commits/develop --jq '.sha[0:7]' 2>/dev/null || echo "unknown")

# --- Insert/refresh freshness banner at the very top ---------------------
# Banner block has stable delimiters so we can find + replace it idempotently.
python3 - "$HANDOFF" "$TS" "$TRIGGERED_BY" "$CAIA_SHA" "$STOL_SHA" "$PAUSED" "$PHASE" <<'PY'
import sys, re

path, ts, trig, caia_sha, stol_sha, paused, phase = sys.argv[1:8]
with open(path) as f:
    t = f.read()

BEGIN = "<!-- HANDOFF_FRESHNESS_BANNER:BEGIN -->"
END = "<!-- HANDOFF_FRESHNESS_BANNER:END -->"
banner = (
    f"{BEGIN}\n"
    f"> **Last refreshed:** {ts}  \n"
    f"> **Triggered by:** {trig}  \n"
    f"> **Latest develop SHA — caia:** {caia_sha} / **stolution:** {stol_sha}  \n"
    f"> **Staleness check:** If you are reading this and the refresh timestamp above is "
    f">30 min old, run `~/.caia/handoff/refresh_handoff.sh` first before trusting the rest.\n"
    f"{END}\n"
)

if BEGIN in t and END in t:
    t = re.sub(
        re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?",
        banner,
        t,
        count=1,
        flags=re.S,
    )
else:
    # Insert banner immediately after the first H1 line (or at top if none).
    m = re.search(r"^(# [^\n]*\n)", t, flags=re.M)
    if m:
        idx = m.end()
        t = t[:idx] + "\n" + banner + "\n" + t[idx:]
    else:
        t = banner + "\n" + t

# Update Last updated line (preserve old behavior for compatibility)
t = re.sub(
    r"\*\*Last updated:\*\*[^\n]*\n",
    f"**Last updated:** {ts} (auto; trigger={trig}; chain {paused} at phase {phase})\n",
    t,
    count=1,
)

with open(path, "w") as f:
    f.write(t)
PY

# --- Refresh open PR list (best-effort; silent on failure) ---------------
PRS=$(gh pr list --state open --limit 20 --repo prakashgbid/caia --json number,title 2>/dev/null \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('\n'.join(f\"- #{p['number']} {p['title']}\" for p in d))" 2>/dev/null)
if [ -n "$PRS" ]; then
  python3 - "$HANDOFF" "$PRS" <<'PY'
import sys,re
path,prs=sys.argv[1:3]
with open(path) as f: t=f.read()
t=re.sub(r'(## Open PRs requiring merge[^\n]*\n\n)(.*?)(\n## )',lambda m:m.group(1)+f"_Auto-refreshed list:_\n\n{prs}\n"+m.group(3),t,count=1,flags=re.S)
with open(path,'w') as f: f.write(t)
PY
fi

# --- H-10: Active alerts section (option B — pulled from JSONL, never edited
# in-place into SESSION_HANDOFF.md). Refresh script overwrites the fenced
# block on every tick, so append_alert.sh + caia-chain emit-alert just write
# to active_alerts.jsonl and don't need to touch the handoff markdown at all.
ALERTS_FILE="$HOME/.caia/handoff/active_alerts.jsonl"
python3 - "$HANDOFF" "$ALERTS_FILE" <<'PY'
import sys, os, json, re
from datetime import datetime, timezone, timedelta
path, alerts_path = sys.argv[1:3]
BEGIN = "<!-- HANDOFF_ACTIVE_ALERTS:BEGIN -->"
END = "<!-- HANDOFF_ACTIVE_ALERTS:END -->"

now = datetime.now(timezone.utc)
cutoff = now - timedelta(hours=24)

alerts = []
if os.path.exists(alerts_path):
    with open(alerts_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            ts = rec.get("ts", "")
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                continue
            if t < cutoff:
                continue
            alerts.append((t, rec))

# Dedupe by fingerprint — keep most recent per fingerprint (within the 24h
# window). Newest-first ordering in the rendered list.
by_fp = {}
for t, rec in alerts:
    fp = rec.get("fingerprint", f"{rec.get('chain','?')}|{rec.get('type','?')}|{t.date()}")
    cur = by_fp.get(fp)
    if cur is None or cur[0] < t:
        by_fp[fp] = (t, rec)
items = sorted(by_fp.values(), key=lambda kv: kv[0], reverse=True)

if items:
    lines = [BEGIN, "", f"## Active alerts (last 24h, {len(items)} unique by fingerprint)", ""]
    for t, rec in items:
        sev = rec.get("severity", "?")
        typ = rec.get("type", "?")
        chain = rec.get("chain", "?")
        detail = (rec.get("detail") or "").replace("\n", " ").strip()
        ts = rec.get("ts", "")
        lines.append(f"- **[{sev}]** `{typ}` — `{chain}` ({ts})")
        if detail:
            lines.append(f"  - {detail[:300]}")
    lines.append("")
    lines.append("_Pulled from `~/.caia/handoff/active_alerts.jsonl`; rebuilt on every refresh tick._")
    lines.append(END)
    block = "\n".join(lines) + "\n"
else:
    block = BEGIN + "\n\n_No active alerts in the last 24h._\n\n" + END + "\n"

with open(path) as f:
    t = f.read()
if BEGIN in t and END in t:
    t = re.sub(
        re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?",
        block,
        t,
        count=1,
        flags=re.S,
    )
else:
    # Insert immediately after the freshness banner if present, else after the H1.
    m = re.search(re.escape("<!-- HANDOFF_FRESHNESS_BANNER:END -->") + r"\n?", t)
    if m:
        idx = m.end()
        t = t[:idx] + "\n" + block + "\n" + t[idx:]
    else:
        m2 = re.search(r"^(# [^\n]*\n)", t, flags=re.M)
        if m2:
            idx = m2.end()
            t = t[:idx] + "\n" + block + "\n" + t[idx:]
        else:
            t = block + "\n" + t

with open(path, "w") as f:
    f.write(t)
PY

# --- Audit line so callers can verify the refresh actually fired ---------
mkdir -p "$HOME/.caia/handoff"
printf '%s\t%s\n' "$TS" "$TRIGGERED_BY" >> "$HOME/.caia/handoff/refresh.log"
exit 0
