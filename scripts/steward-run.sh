#!/usr/bin/env bash
# steward-run.sh — Wrapper for the Steward CLI invoked by launchd
# (com.steward.daily / com.steward.weekly). Aggregates the appropriate
# subcommands per cadence and writes a timestamped log line per run.
#
# Why a wrapper instead of putting `steward-gatekeeper.mjs daily` directly
# in the plist: the set of subcommands we want to run as "daily" / "weekly"
# evolves over campaigns (new analyzers ship; coverage expands). Keeping
# the routing in a script means we can add more checks without touching
# the plist (which is a slower change because it requires `launchctl
# unload && load` to pick up).
#
# Usage (invoked by launchd):
#   bash scripts/steward-run.sh daily
#   bash scripts/steward-run.sh weekly
#
# Usage (manual / debug):
#   bash scripts/steward-run.sh daily | tee /tmp/steward-daily.log
#
# Reference: agent/memory/steward_gatekeeper_directive.md (modes 4-10),
#            ~/Documents/projects/reports/principal-overnight-shipped-2026-05-04.md.

set -uo pipefail
# Note: NOT using `set -e` — we want to run all checks even if one is
# non-zero, then return the worst exit code at the end.

cadence="${1:-}"
if [[ "${cadence}" != "daily" && "${cadence}" != "weekly" ]]; then
  echo "usage: $0 <daily|weekly>" >&2
  exit 2
fi

# When invoked from the repo: HERE = repo root.
# When invoked from ~/bin/ (launchd path): fall back to CAIA_REPO_DIR env
# (default: /Users/MAC/Documents/projects/caia, matching this operator's
# canonical layout — override via launchd plist EnvironmentVariables to
# install elsewhere).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -d "${SCRIPT_DIR}/../packages/steward-analyzers" ]]; then
  HERE="$(cd "${SCRIPT_DIR}/.." && pwd)"
else
  HERE="${CAIA_REPO_DIR:-/Users/MAC/Documents/projects/caia}"
fi
CLI="${HERE}/packages/steward-analyzers/bin/steward-gatekeeper.mjs"
NODE="${NODE_BIN:-/opt/homebrew/bin/node}"
[[ -x "${NODE}" ]] || NODE="$(command -v node || true)"
[[ -n "${NODE}" ]] || { echo "node not found" >&2; exit 2; }
[[ -f "${CLI}" ]] || { echo "steward CLI not found at ${CLI}" >&2; exit 2; }

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

worst=0
record_exit() {
  local ec=$1
  if (( ec > worst )); then worst=${ec}; fi
}

run_check() {
  local name=$1
  shift
  echo "[$(ts)] ── steward ${cadence} :: ${name} ──"
  "${NODE}" "${CLI}" "$@"
  local ec=$?
  if (( ec != 0 )); then
    record_exit ${ec}
  fi
  echo
}

cd "${HERE}"

case "${cadence}" in
  daily)
    # Failure modes 4, 5, 6 (filesystem-local hygiene)
    run_check "hygiene-daily" hygiene-daily
    # Failure mode 7 (Mac-side snapshot freshness; stolution-side is on stolution cron)
    run_check "vault-checks" vault-checks
    ;;
  weekly)
    # Weekly = daily plus mode 10 (PR staleness) listed only — the
    # action-side close lives in .github/workflows/stale-pr-cleanup.yml
    # (server cron) so we never double-close from launchd.
    run_check "hygiene-daily" hygiene-daily
    run_check "vault-checks" vault-checks
    # pr-stale subcommand is shipped in PR #306 / develop tip; once that
    # lands, the line below starts producing findings. Until then it
    # exits with usage error (handled by `record_exit`, doesn't crash).
    run_check "pr-stale" pr-stale
    ;;
esac

echo "[$(ts)] steward ${cadence} complete; worst exit code: ${worst}"
exit ${worst}
