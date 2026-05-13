#!/usr/bin/env bash
# =============================================================================
# scripts/review-siblings/dispatch.sh
# =============================================================================
# Common review-sibling dispatcher. Spawns the four review-siblings in
# PARALLEL (they're independent — see DESIGN below) and aggregates verdicts:
#
#   * @chiefaia/critic         — security/regression/cost     (BLOCKING)
#   * @chiefaia/code-reviewer  — correctness/style/types/tests (BLOCKING)
#   * @chiefaia/reviewer       — craftsmanship                 (ADVISORY)
#   * @chiefaia/verifier       — acceptance-criteria-satisfaction
#                                (BLOCKING for autonomous-loop,
#                                 ADVISORY for operator-routed)
#
# The dispatcher is the canonical entry point for both:
#   (a) the autonomous-loop spawner (vendored from caia and called via
#       claude_spawner_agent.py's review-sibling-dispatch hook); and
#   (b) the per-PR GitHub Actions workflows (each sibling already has its
#       own workflow; this script is the local-dev / autonomous-loop entry
#       so the four siblings can run as a single cohesive batch).
#
# DESIGN — independence:
#   Each sibling reads the diff and emits a verdict; none modifies state
#   the others depend on. They ARE allowed to share the diff file (read-
#   only) but each operates in its own pid + cwd. The verifier additionally
#   creates its own /tmp/verifier_* worktree. This makes parallel dispatch
#   safe and ~Nx faster than serial.
#
# Exit codes:
#   0   all blocking siblings PASS (advisory siblings can FAIL or PASS;
#       --routing-class autonomous-loop also requires verifier=pass).
#   1   at least one blocking sibling FAIL.
#   2   transport / setup error (couldn't find diff file, bad arg, ...).
#
# Usage:
#   scripts/review-siblings/dispatch.sh \
#     --pr <number> \
#     --diff-file /tmp/pr.diff \
#     --base-branch develop \
#     --branch <head-branch> \
#     --title "PR title" \
#     --routing-class {autonomous-loop|operator-routed} \
#     [--verifier-inputs /path/to/inputs.json]   # required when routing-class!=skip
#     [--out-dir /tmp/sibling-verdicts]          # default: $PWD/.review-siblings
# =============================================================================
set -uo pipefail

PR=""
DIFF_FILE=""
BASE_BRANCH="develop"
BRANCH="unknown"
TITLE=""
ROUTING_CLASS="autonomous-loop"
VERIFIER_INPUTS=""
OUT_DIR="${PWD}/.review-siblings"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)              PR="$2"; shift 2 ;;
    --diff-file)       DIFF_FILE="$2"; shift 2 ;;
    --base-branch)     BASE_BRANCH="$2"; shift 2 ;;
    --branch)          BRANCH="$2"; shift 2 ;;
    --title)           TITLE="$2"; shift 2 ;;
    --routing-class)   ROUTING_CLASS="$2"; shift 2 ;;
    --verifier-inputs) VERIFIER_INPUTS="$2"; shift 2 ;;
    --out-dir)         OUT_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,40p' "$0"; exit 0 ;;
    *)
      echo "dispatch: unknown arg $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PR" ]] || [[ -z "$DIFF_FILE" ]] || [[ ! -f "$DIFF_FILE" ]]; then
  echo "dispatch: --pr <n> and --diff-file <existing path> are required" >&2
  exit 2
fi
if [[ "$ROUTING_CLASS" != "autonomous-loop" && "$ROUTING_CLASS" != "operator-routed" ]]; then
  echo "dispatch: --routing-class must be one of {autonomous-loop, operator-routed}" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

# subscription-only — strip API key once at top so all siblings inherit clean env
unset ANTHROPIC_API_KEY

# -------------------------------------------------------------------------
# Spawn each sibling in parallel. Each writes its verdict JSON to OUT_DIR.
# We capture the pid + exit-code via wait so we can map FAIL->blocking.
# -------------------------------------------------------------------------

PIDS=()
NAMES=()

run_sibling() {
  local name="$1" cmd="$2"
  ( eval "$cmd" >"$OUT_DIR/${name}.stdout" 2>"$OUT_DIR/${name}.stderr"; echo "$?" >"$OUT_DIR/${name}.rc" ) &
  PIDS+=("$!")
  NAMES+=("$name")
}

# The blocking siblings — share the same diff file.
run_sibling critic \
  "node $REPO_ROOT/packages/critic/dist/cli.js review --pr '$PR' --diff-file '$DIFF_FILE' --output json --base-branch '$BASE_BRANCH' --branch '$BRANCH' --title '$TITLE'"

run_sibling code-reviewer \
  "node $REPO_ROOT/packages/code-reviewer/dist/cli.js review --pr '$PR' --diff-file '$DIFF_FILE' --output json --base-branch '$BASE_BRANCH' --branch '$BRANCH' --title '$TITLE'"

# Advisory sibling — never blocks, but its verdict is logged.
run_sibling reviewer \
  "node $REPO_ROOT/packages/reviewer/dist/cli.js review --pr '$PR' --diff-file '$DIFF_FILE' --output json --base-branch '$BASE_BRANCH' --branch '$BRANCH' --title '$TITLE' || true"

# Verifier — only meaningful when verifier inputs JSON is provided. Skipped
# when --verifier-inputs is omitted (e.g. PRs that aren't tied to an SPS
# task; those routes get verdicts from the other three siblings only).
if [[ -n "$VERIFIER_INPUTS" ]] && [[ -f "$VERIFIER_INPUTS" ]]; then
  run_sibling verifier \
    "$REPO_ROOT/packages/verifier/bin/run-verifier.sh --inputs '$VERIFIER_INPUTS' --out '$OUT_DIR/verifier.verdict.json' --repo '$REPO_ROOT'"
else
  echo "dispatch: --verifier-inputs not provided; skipping verifier (routing=$ROUTING_CLASS)"
fi

# Wait for every spawned child.
for pid in "${PIDS[@]}"; do
  wait "$pid" || true   # rc captured to file, not via $?
done

# -------------------------------------------------------------------------
# Aggregate verdicts. Blocking semantics:
#   - critic / code-reviewer FAIL  => blocking fail
#   - verifier overall=fail AND routing=autonomous-loop => blocking fail
#   - verifier overall=fail AND routing=operator-routed => advisory only
#   - reviewer is always advisory
# -------------------------------------------------------------------------

BLOCKING_FAILED=0
SUMMARY=""

for name in "${NAMES[@]}"; do
  rc_file="$OUT_DIR/${name}.rc"
  rc=$(cat "$rc_file" 2>/dev/null || echo "??")
  case "$name" in
    critic|code-reviewer)
      if [[ "$rc" != "0" ]]; then
        BLOCKING_FAILED=1
        SUMMARY+="  - $name: BLOCKING-FAIL (rc=$rc)\n"
      else
        SUMMARY+="  - $name: PASS\n"
      fi
      ;;
    reviewer)
      if [[ "$rc" != "0" ]]; then
        SUMMARY+="  - $name: ADVISORY-FAIL (rc=$rc; non-blocking)\n"
      else
        SUMMARY+="  - $name: ADVISORY-PASS\n"
      fi
      ;;
    verifier)
      if [[ "$rc" == "0" ]]; then
        SUMMARY+="  - $name: PASS\n"
      else
        if [[ "$ROUTING_CLASS" == "autonomous-loop" ]]; then
          BLOCKING_FAILED=1
          SUMMARY+="  - $name: BLOCKING-FAIL (rc=$rc; routing=autonomous-loop)\n"
        else
          SUMMARY+="  - $name: ADVISORY-FAIL (rc=$rc; routing=operator-routed)\n"
        fi
      fi
      ;;
  esac
done

echo "review-siblings dispatch summary (PR=$PR, routing=$ROUTING_CLASS):"
printf "%b" "$SUMMARY"
echo "verdict files in: $OUT_DIR"

exit "$BLOCKING_FAILED"
