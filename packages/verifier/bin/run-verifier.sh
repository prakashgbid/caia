#!/usr/bin/env bash
# =============================================================================
# run-verifier.sh — operator/spawner-side verifier launcher with hardened
# worktree lifecycle.
#
# Wraps `node dist/cli.js verify --input <inputs.json>` with a bash trap that
# cleans up the worktree even on SIGTERM/SIGINT/script-crash. The trap is
# defence-in-depth on top of the agent's own try/finally cleanup — together
# they guarantee no leaked /tmp/verifier_* dirs even if the node process is
# killed mid-spawn.
#
# Subscription-only: `unset ANTHROPIC_API_KEY` happens here so the inherited
# env from the calling shell never leaks into `claude --print`.
#
# Exit codes:
#   0   verdict.overall == 'pass'
#   1   verdict.overall == 'fail' (autonomous-loop will surface as failed)
#   2   schema/parse/transport error (treated as fail-impl by spawner)
#  124  timeout (matches `timeout(1)` convention)
#
# Usage:
#   run-verifier.sh \
#     --inputs /path/to/inputs.json \
#     --out    /path/to/verdict.json \
#     [--repo  /abs/path/to/repo] \
#     [--budget-seconds 900]
# =============================================================================
set -uo pipefail

INPUTS=""
OUT=""
REPO_PATH="${PWD}"
BUDGET_SECONDS=900
JOB_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --inputs)         INPUTS="$2"; shift 2 ;;
    --out)            OUT="$2"; shift 2 ;;
    --repo)           REPO_PATH="$2"; shift 2 ;;
    --budget-seconds) BUDGET_SECONDS="$2"; shift 2 ;;
    --job-id)         JOB_ID="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *)
      echo "run-verifier: unknown arg $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$INPUTS" ]] || [[ ! -f "$INPUTS" ]]; then
  echo "run-verifier: --inputs <path> is required and must exist" >&2
  exit 2
fi
if [[ -z "$OUT" ]]; then
  OUT="$(mktemp -t verifier_verdict_XXXXXX.json)"
fi

# subscription-only — strip API key from spawn env (defence-in-depth on top
# of the node agent's env scrub).
unset ANTHROPIC_API_KEY

# Default JOB_ID derives from the inputs file's task_id field for stable
# worktree paths across retries (idempotent cleanup if a prior run left a
# leftover worktree dir).
if [[ -z "$JOB_ID" ]]; then
  JOB_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).taskId || 'unknown')" "$INPUTS" 2>/dev/null || echo unknown)"
  JOB_ID="${JOB_ID}-$$"
fi
WORKTREE="/tmp/verifier_${JOB_ID}"

# Defence-in-depth cleanup. Runs on EXIT (every script termination path),
# including when the node child is killed by the timeout below or when a
# SIGTERM is delivered to this wrapper. The agent itself ALSO cleans up,
# so this is belt-and-braces — both must be safe to no-op when the worktree
# is already gone.
cleanup() {
  local rc=$?
  # `git worktree remove --force` is idempotent on a missing path (errors
  # but doesn't leave residue); the rm -rf below tolerates the same.
  ( cd "$REPO_PATH" 2>/dev/null && git worktree remove --force "$WORKTREE" >/dev/null 2>&1 ) || true
  rm -rf "$WORKTREE" 2>/dev/null || true
  ( cd "$REPO_PATH" 2>/dev/null && git worktree prune >/dev/null 2>&1 ) || true
  exit "$rc"
}
trap cleanup EXIT INT TERM HUP

# Inject the worktree path into the inputs blob so the agent uses our
# trap-protected path rather than minting its own. Pure-stdlib jq replacement
# via node so we don't take a jq dep.
PATCHED_INPUTS="$(mktemp -t verifier_inputs_XXXXXX.json)"
node -e "
const fs=require('node:fs');
const inputs=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
inputs.verifierWorktree=process.argv[2];
fs.writeFileSync(process.argv[3], JSON.stringify(inputs));
" "$INPUTS" "$WORKTREE" "$PATCHED_INPUTS"

# Pre-create the worktree from the patched inputs' prHeadSha. This ensures
# the trap-protected path exists before the node process runs.
HEAD_SHA="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).prHeadSha)" "$PATCHED_INPUTS")"
( cd "$REPO_PATH" && git worktree add --detach "$WORKTREE" "$HEAD_SHA" ) >/tmp/verifier_${JOB_ID}.wt-add.log 2>&1 || {
  echo "run-verifier: failed to create worktree at $WORKTREE for $HEAD_SHA" >&2
  cat "/tmp/verifier_${JOB_ID}.wt-add.log" >&2 || true
  exit 2
}

# Run the agent with a hard budget — the GNU/BSD timeout cmd sends SIGTERM
# at deadline; our trap fires regardless.
DIST="$(cd "$(dirname "$0")/.." && pwd)/dist/cli.js"
if ! command -v timeout >/dev/null 2>&1; then
  # macOS without coreutils — fall back to no external timeout (the agent's
  # internal deadline still applies).
  node "$DIST" verify --input "$PATCHED_INPUTS" --out "$OUT"
  RC=$?
else
  timeout "${BUDGET_SECONDS}s" node "$DIST" verify --input "$PATCHED_INPUTS" --out "$OUT"
  RC=$?
fi

# trap cleanup() will fire on exit. RC propagates to the spawner.
exit "$RC"
