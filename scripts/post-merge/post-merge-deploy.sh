#!/usr/bin/env bash
# INT.1.A1 — post-merge deploy stub.
#
# Receives a queue row JSON as argv[1] from `post-merge-watcher.sh`.
# Logs the merge + dispatches per-repo deploy actions. Today's deploy
# actions:
#   - prakashgbid/caia : when the merge touches local-llm-router (title
#                        regex) or carries ROUTER-DAEMON-RELOAD-REQUIRED
#                        in its PR body, `launchctl kickstart -k` the
#                        router LaunchAgent so the new binary is loaded.
#                        (Closes the "stale binary" gap from 2026-05-15
#                        — see reports/integration_a1_post_merge_signal_2026-05-15.md.)
#   - prakashgbid/stolution : stub (extend with K3s rollout / ssh deploy).
#
# Operator extension point: add a new `case "$repo" in` branch, or add
# a new entry to the DAEMON_KICKSTART_RULES table for "PR touches X →
# kickstart Y" wiring.

set -euo pipefail

POSTMERGE_HOME="${POSTMERGE_HOME:-$HOME/.caia/post-merge}"
mkdir -p "$POSTMERGE_HOME"

# --- health-check shortcut ---------------------------------------------------
if [[ "${1:-}" == "--health-check" ]]; then
  printf '{"ok":true,"name":"post-merge-deploy","home":"%s"}\n' "$POSTMERGE_HOME"
  exit 0
fi

row="${1:-}"
if [[ -z "$row" ]]; then
  echo "usage: post-merge-deploy.sh <row-json>" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo '{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","level":"error","event":"deploy_jq_missing"}'
  exit 0
fi

repo="$(printf '%s' "$row" | jq -r '.repo // "unknown"')"
sha="$(printf '%s' "$row" | jq -r '.merge_sha // "unknown"')"
pr="$(printf '%s' "$row" | jq -r '.pr_number // "unknown"')"
base="$(printf '%s' "$row" | jq -r '.base_branch // "unknown"')"
title="$(printf '%s' "$row" | jq -r '.pr_title // ""')"
body_inline="$(printf '%s' "$row" | jq -r '.pr_body // ""')"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

repo_safe="${repo//\//__}"
per_repo_log="$POSTMERGE_HOME/${repo_safe}.deploy.log"
mkdir -p "$(dirname "$per_repo_log")"

printf '[%s] saw merge %s for %s PR #%s on %s\n' "$ts" "$sha" "$repo" "$pr" "$base" >> "$per_repo_log"

# Stub log line — operator extends with per-repo actions.
printf '{"ts":"%s","level":"info","event":"deploy_stub","repo":"%s","merge_sha":"%s","pr_number":"%s","base_branch":"%s"}\n' \
  "$ts" "$repo" "$sha" "$pr" "$base"

# --- helpers ---------------------------------------------------------------

# Resolve PR body. Prefer the inline copy from the queue row (zero API
# hop); fall back to `gh pr view` for older schema_version=1 rows.
resolve_pr_body() {
  if [[ -n "$body_inline" && "$body_inline" != "null" ]]; then
    printf '%s' "$body_inline"
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$pr" == "unknown" || "$pr" == "null" ]]; then
    return 0
  fi
  gh pr view "$pr" --repo "$repo" --json body --jq '.body // ""' 2>/dev/null || true
}

kickstart_daemon() {
  local label="$1"
  local rc=0
  local before_pid after_pid
  before_pid="$(launchctl list 2>/dev/null | awk -v L="$label" '$3==L {print $1}')"
  launchctl kickstart -k "gui/$(id -u)/$label" >/dev/null 2>&1 || rc=$?
  # Brief settle so the new PID is observable in the log.
  sleep 1
  after_pid="$(launchctl list 2>/dev/null | awk -v L="$label" '$3==L {print $1}')"
  printf '{"ts":"%s","level":"info","event":"daemon_kickstart","label":"%s","rc":%d,"pid_before":"%s","pid_after":"%s","trigger_pr":"%s","trigger_repo":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$rc" "${before_pid:-none}" "${after_pid:-none}" "$pr" "$repo"
}

# --- per-repo deploy plug-in points ----------------------------------------
case "$repo" in
  prakashgbid/caia)
    # Router-daemon-reload wiring (institutionalized 2026-05-15).
    # Triggers on either signal:
    #   1) PR title matches `local-llm-router` or `router-daemon` (auto, zero-friction)
    #   2) PR body contains `ROUTER-DAEMON-RELOAD-REQUIRED` (explicit override
    #      for non-obvious changes — e.g. a config change in another package
    #      that nonetheless mandates a router restart)
    body="$(resolve_pr_body)"
    if [[ "$title" =~ (local-llm-router|router-daemon) ]] || \
       [[ "$body" == *"ROUTER-DAEMON-RELOAD-REQUIRED"* ]]; then
      printf '{"ts":"%s","level":"info","event":"router_reload_triggered","reason":"title_or_tag_match","pr_number":"%s","title":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pr" "$(printf '%s' "$title" | jq -Rs .)"
      kickstart_daemon "com.chiefaia.local-llm-router"
    fi
    ;;
  prakashgbid/stolution)
    # TODO: SSH to stolution, rsync new state, run deploy-*.sh idempotently.
    :
    ;;
  *)
    :
    ;;
esac

exit 0
