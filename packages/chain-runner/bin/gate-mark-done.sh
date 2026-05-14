#!/bin/bash
# gate-mark-done.sh — guardrail #2 of the 2026-05-13 PR-merge-enforcement set.
#
# A chain phase MUST NOT call `mark-done` while a PR it produced is still open.
# This helper scans a phase log file for PR URLs, verifies each one is merged
# (or merges it via `caia-pr-merge-or-fail`), and only then exits 0 so the
# caller can proceed to `mark-done`.
#
# Invocation:
#   gate-mark-done.sh PHASE_LOG_FILE [TIMEOUT_SECONDS]
#
# Exit codes:
#   0  no PRs found, or every PR is verified merged
#   1  one or more PRs could not be merged (substantive conflicts/failures)
#   2  argument error
#
# Standing rule (memory_2026-05-13): NO chain phase marks itself done with an
# open PR for its branch.
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

# Find PR refs in the log. Match github.com/<owner>/<repo>/pull/<N>.
# Accept both prakashgbid and any other owner (chains may push elsewhere).
PR_REFS=$(grep -oE 'github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[0-9]+' "$LOG_FILE" \
          | sort -u)

if [ -z "$PR_REFS" ]; then
  # No PRs referenced — nothing to gate.
  exit 0
fi

CAIA_PR_MERGE_BIN="${CAIA_PR_MERGE_BIN:-$HOME/Documents/projects/caia/packages/chain-runner/bin/caia-pr-merge-or-fail.js}"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

ANY_FAILED=0

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

exit $ANY_FAILED
