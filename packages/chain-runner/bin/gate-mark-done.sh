#!/bin/bash
# gate-mark-done.sh — guardrail #2 of the 2026-05-13 PR-merge-enforcement set,
# now also the chokepoint for guardrail #10 (adoption-everywhere).
#
# A chain phase MUST NOT call `mark-done` while either:
#   G2  — a PR it produced is still open / closed-unmerged, OR
#   G10 — an adoption opportunity recorded for the chain is still pending
#         (any non-{merged,deferred} state, or stuck in 'opened' > 14d).
#
# This helper scans a phase log file for PR URLs, verifies each one is merged
# (or merges it via `caia-pr-merge-or-fail`), then runs `caia-adopt gate-check
# --chain $CHAIN_ID` for the adoption check, and only exits 0 if every gate
# passes.
#
# Invocation:
#   gate-mark-done.sh PHASE_LOG_FILE [TIMEOUT_SECONDS]
#
# Environment:
#   CAIA_CHAIN_ID         (optional) chain id used by the adoption-everywhere
#                         gate (G10). When set, the script runs
#                         `caia-adopt gate-check --chain "$CAIA_CHAIN_ID"`
#                         as a final step. When unset, the script tries to
#                         derive it from LOG_FILE's path (~/.caia/chain/<id>/).
#                         If neither yields a chain id, the adoption gate is
#                         skipped with a warning (graceful degradation while
#                         the substrate is still being adopted everywhere).
#   CAIA_ADOPT_BIN        (optional) path to the caia-adopt CLI. Defaults to
#                         the packages/adoption-enforcement/bin/caia-adopt.mjs
#                         in this repo.
#
# Exit codes:
#   0  no PRs found (or every PR verified merged) AND adoption gate ok
#   1  one or more PRs could not be merged, OR adoption gate refused
#   2  argument error
#
# Standing rule (memory_2026-05-13): NO chain phase marks itself done with an
# open PR for its branch. The G10 extension (2026-05-16) adds the same
# refusal contract for open adoption opportunities.
#
# DEPRECATION (chain-runner-battle-harden phase 9, 2026-05-14, H-15).
# The PR-merge guardrail is now FIRST-CLASS inside `caia-chain mark-done` via
# the success_criteria.requires_merged_pr field and the acceptance.ts validator.
# This bash helper is kept operational for phases that still call it directly,
# and is removed in phase 11 (H-29). New phases should set:
#   success_criteria:
#     requires_merged_pr: true
#     enforce: strict        # opt in if you want hard-refusal
# in the chain YAML instead of calling this script.

set -u

LOG_FILE="${1:-}"
TIMEOUT_SECONDS="${2:-900}"

if [ -z "$LOG_FILE" ] || [ ! -r "$LOG_FILE" ]; then
  echo "gate-mark-done: missing or unreadable LOG_FILE arg" >&2
  exit 2
fi

CAIA_PR_MERGE_BIN="${CAIA_PR_MERGE_BIN:-$HOME/Documents/projects/caia/packages/chain-runner/bin/caia-pr-merge-or-fail.js}"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

ANY_FAILED=0

# G10: resolve chain id once. Caller may set CAIA_CHAIN_ID; otherwise derive
# from LOG_FILE's path when it sits under ~/.caia/chain/<id>/.
CHAIN_ID="${CAIA_CHAIN_ID:-}"
if [ -z "$CHAIN_ID" ]; then
  case "$LOG_FILE" in
    *"/.caia/chain/"*)
      CHAIN_ID=$(echo "$LOG_FILE" | sed -E 's#.*/\.caia/chain/([^/]+)/.*#\1#')
      ;;
  esac
fi

# Find PR refs in the log. Match github.com/<owner>/<repo>/pull/<N>.
# Accept both prakashgbid and any other owner (chains may push elsewhere).
PR_REFS=$(grep -oE 'github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[0-9]+' "$LOG_FILE" \
          | sort -u)

if [ -n "$PR_REFS" ]; then
  while IFS= read -r ref; do
    # ref = github.com/OWNER/REPO/pull/N
    owner=$(echo "$ref" | awk -F/ '{print $2}')
    repo=$(echo "$ref" | awk -F/ '{print $3}')
    pr=$(echo  "$ref" | awk -F/ '{print $5}')
    full="${owner}/${repo}"
    if [ -z "$pr" ] || [ -z "$full" ]; then continue; fi

    # Check current state
    state=$(gh pr view "$pr" --repo "$full" --json state -q '.state' 2>/dev/null || echo "")
    if [ "$state" = "MERGED" ]; then
      echo "gate-mark-done: $full#$pr already MERGED — ok" >&2
      continue
    fi
    if [ "$state" = "CLOSED" ]; then
      echo "gate-mark-done: $full#$pr CLOSED (unmerged) — refusing to mark-done" >&2
      ANY_FAILED=1
      continue
    fi
    if [ -z "$state" ]; then
      # Could be a PR in another repo we don't have access to. Skip with note.
      echo "gate-mark-done: $full#$pr state-unknown — skipping" >&2
      continue
    fi

    # state is OPEN — attempt merge via the helper
    echo "gate-mark-done: $full#$pr is OPEN, invoking caia-pr-merge-or-fail" >&2
    if "$NODE_BIN" "$CAIA_PR_MERGE_BIN" \
          --repo "$full" --pr "$pr" \
          --timeout-seconds "$TIMEOUT_SECONDS"; then
      echo "gate-mark-done: $full#$pr merged ok" >&2
    else
      echo "gate-mark-done: $full#$pr could not be merged — refusing to mark-done" >&2
      ANY_FAILED=1
    fi
  done <<< "$PR_REFS"
fi

# Final step: adoption-everywhere gate (DoD v2 G10). Same exit-code semantics
# as the PR-merge loop above — a block here means "refusing to mark-done"
# with exit 1. Override path is `caia-chain mark-done --adoption-pending-ok
# --reason "<why>"` invoked directly (bypassing this wrapper).
if [ -n "$CHAIN_ID" ]; then
  CAIA_ADOPT_BIN="${CAIA_ADOPT_BIN:-$HOME/Documents/projects/caia/packages/adoption-enforcement/bin/caia-adopt.mjs}"
  if [ -r "$CAIA_ADOPT_BIN" ]; then
    if "$NODE_BIN" "$CAIA_ADOPT_BIN" gate-check --chain "$CHAIN_ID" >&2; then
      echo "gate-mark-done: adoption gate ok for chain=$CHAIN_ID" >&2
    else
      echo "gate-mark-done: adoption gate BLOCKED chain=$CHAIN_ID — refusing to mark-done" >&2
      ANY_FAILED=1
    fi
  else
    echo "gate-mark-done: caia-adopt bin not found at $CAIA_ADOPT_BIN — adoption gate SKIPPED" >&2
  fi
else
  echo "gate-mark-done: no CAIA_CHAIN_ID resolved — adoption gate SKIPPED" >&2
fi

exit $ANY_FAILED
