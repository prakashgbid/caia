#!/usr/bin/env bash
# INT.1.A1 — post-merge deploy stub.
#
# Receives a queue row JSON as argv[1] from `post-merge-watcher.sh`.
# Today: records "saw merge $sha" to a per-repo log + the central
# log.jsonl. Per-repo deploy actions plug in here later (e.g. K3s rollout
# for stolution, plist re-bootstrap for caia packages).
#
# Operator extension point: add a `case $repo in` branch with the deploy
# command for that repo.

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
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

repo_safe="${repo//\//__}"
per_repo_log="$POSTMERGE_HOME/${repo_safe}.deploy.log"
mkdir -p "$(dirname "$per_repo_log")"

printf '[%s] saw merge %s for %s PR #%s on %s\n' "$ts" "$sha" "$repo" "$pr" "$base" >> "$per_repo_log"

# Stub log line — operator extends with per-repo actions.
printf '{"ts":"%s","level":"info","event":"deploy_stub","repo":"%s","merge_sha":"%s","pr_number":"%s","base_branch":"%s"}\n' \
  "$ts" "$repo" "$sha" "$pr" "$base"

# --- per-repo deploy plug-in points (extend below) --------------------------
case "$repo" in
  prakashgbid/caia)
    # TODO: invoke per-package install scripts when packages/<x>/scripts/install-postmerge.sh exists.
    :
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
