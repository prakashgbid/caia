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
#                        Then fires `dispatch_adoption_xref`, which runs
#                        `caia-adoption-run xref` in the background if
#                        scan.json exists in ~/.caia/post-merge/work/<sha>/
#                        and xref.json doesn't (p3-adoption-cross-ref
#                        phase 4 — Adoption Enforcement Substrate MVP-A).
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

# Adoption-enforcement xref stage. Runs `caia-adoption-run xref` after the
# scan stage (p3-adoption-scan-engine, future MVP-A) has produced scan.json
# in the per-sha work dir. Background, hard-capped at 60 s. Idempotent —
# skips when xref.json is already present. Until the scan stage lands,
# scan.json never exists and this is a no-op.
#
# On a successful xref the ledger gets one append:
#   { ts, event:"xref_done", sha, artefact_count, candidate_count }
# Ledger schema lands fully in p3-dod-v2-adoption-gate phase 1; this is the
# minimum-viable append that the gate's reader will see.
dispatch_adoption_xref() {
  local work_dir="$POSTMERGE_HOME/work/$sha"
  local scan_path="$work_dir/scan.json"
  local xref_path="$work_dir/xref.json"
  local log_path="$work_dir/xref.log"
  local ledger_path="$POSTMERGE_HOME/adoption.jsonl"
  local repo_root="${CAIA_REPO_ROOT:-$HOME/Documents/projects/caia}"
  local run_bin="$repo_root/packages/adoption-enforcement/bin/caia-adoption-run.mjs"
  local node_bin="${NODE_BIN:-/opt/homebrew/opt/node@22/bin/node}"
  [[ -x "$node_bin" ]] || node_bin="$(command -v node 2>/dev/null || echo /opt/homebrew/bin/node)"

  if [[ "$sha" == "unknown" || "$sha" == "null" || -z "$sha" ]]; then return 0; fi
  if [[ ! -f "$scan_path" ]]; then
    printf '{"ts":"%s","level":"info","event":"adoption_xref_skipped","sha":"%s","reason":"scan_missing"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha"
    return 0
  fi
  if [[ -f "$xref_path" ]]; then
    printf '{"ts":"%s","level":"info","event":"adoption_xref_skipped","sha":"%s","reason":"xref_present"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha"
    return 0
  fi
  if [[ ! -x "$node_bin" || ! -f "$run_bin" ]]; then
    printf '{"ts":"%s","level":"warn","event":"adoption_xref_skipped","sha":"%s","reason":"runner_unavailable","node":"%s","bin":"%s"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" "$node_bin" "$run_bin"
    return 0
  fi

  mkdir -p "$work_dir"
  (
    set +e
    perl -e 'alarm shift; exec @ARGV' 60 \
      "$node_bin" "$run_bin" xref --work-dir "$work_dir" --repo "$repo_root" \
      >> "$log_path" 2>&1
    local_rc=$?
    if [[ $local_rc -eq 0 && -f "$xref_path" ]]; then
      a=$(jq -r '.summary.artefact_count // 0' "$xref_path" 2>/dev/null)
      c=$(jq -r '.summary.candidate_count // 0' "$xref_path" 2>/dev/null)
      [[ -z "$a" ]] && a=0
      [[ -z "$c" ]] && c=0
      printf '{"ts":"%s","event":"xref_done","sha":"%s","artefact_count":%s,"candidate_count":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" "$a" "$c" >> "$ledger_path"
    else
      printf '{"ts":"%s","event":"xref_failed","sha":"%s","rc":%d}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" "$local_rc" >> "$ledger_path"
    fi
  ) >/dev/null 2>&1 &
  disown 2>/dev/null || true

  printf '{"ts":"%s","level":"info","event":"adoption_xref_dispatched","sha":"%s","work_dir":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" "$work_dir"
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
    dispatch_adoption_xref
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
