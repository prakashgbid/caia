#!/usr/bin/env bash
#
# pre-send-classifier.sh — mechanical guard rail invoked from the orchestrator
# BEFORE every SendUserMessage when the topic is technical.
#
# Pipe the draft into stdin. Exit code:
#   0 → clean. Send.
#   1 → blocked. Draft contains banned phrasing on a technical topic. Caller
#       must KILL the draft, decide, execute, and send a DIFFERENT message
#       reporting what was done.
#   2 → ambiguous. Draft contains phrasing that may or may not be a tech
#       decision request — caller should re-read feedback_24_7_bulletproof and
#       feedback_decision_classifier before sending.
#
# Source of truth for banned phrases: agent-memory/feedback_24_7_bulletproof_2026-05-08.md
# (table "Banned phrase / What to do instead") and feedback_decision_classifier.md
# step 1 list.
#
# Usage:
#   echo "$DRAFT_TEXT" | pre-send-classifier.sh
#   pre-send-classifier.sh < draft.txt
#
# Optional flag:
#   --topic technical|product   force topic classification (skip auto-detect)
#
# This script is intentionally pure bash + grep so it has no install footprint
# and runs in the orchestrator session, in scheduled-task sessions, in CI, or
# anywhere a draft is composed.

set -euo pipefail

TOPIC="auto"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --topic) TOPIC="$2"; shift 2;;
    -h|--help)
      sed -n '1,40p' "$0"; exit 0;;
    *) shift;;
  esac
done

draft="$(cat)"

# 1) BANNED PHRASES — case-insensitive whole-phrase match.
banned=(
  'would you like'
  'want me to'
  'should i\b'
  'do you want'
  'let me know if'
  'your call'
  'or shall i'
  'thoughts\?'
  'what do you prefer'
  'which one'
  'which would you prefer'
  'path a or path b'
  'three options for you'
  'awaiting your call'
  'awaiting your input'
  'awaiting your decision'
  '\bgo with which\b'
  'should we (use|pick|choose)'
)

hit=""
for phrase in "${banned[@]}"; do
  if grep -E -i -q "$phrase" <<<"$draft"; then
    hit+="$phrase"$'\n'
  fi
done

if [[ -z "$hit" ]]; then
  exit 0
fi

# 2) TOPIC CLASSIFICATION — if auto, scan for technical keywords.
technical_keywords='\b(branch|PR|merge|conflict|CI|workflow|gitflow|gitleaks|semgrep|lockfile|pnpm|npm|tsconfig|eslint|prettier|migrat(e|ion)|dependabot|cve|patch|version|bump|runner|worktree|stash|cherry-pick|rebase|force-push|deploy|launchagent|launchd|cron|systemd|infra|secret|vault|token|kube|k3s|docker|compose|postgres|redis|loki|grafana|mcp|agent|prompt|skill|architecture|refactor|test|coverage|threshold|monorepo|package|module|file layout|naming|conformance|evidence gate|claude code|cowork)\b'

product_keywords='\b(brand|messaging|copy|persona|target customer|business|pricing|feature priority|launch sequence|partnership|product direction|user persona|UX preference)\b'

is_tech=0
is_prod=0
if [[ "$TOPIC" == "auto" ]]; then
  if grep -E -i -q "$technical_keywords" <<<"$draft"; then is_tech=1; fi
  if grep -E -i -q "$product_keywords"   <<<"$draft"; then is_prod=1; fi
elif [[ "$TOPIC" == "technical" ]]; then
  is_tech=1
elif [[ "$TOPIC" == "product" ]]; then
  is_prod=1
fi

cat >&2 <<EOF
[pre-send-classifier] BLOCKED — draft contains banned-decision-asking phrase(s):
$hit
Topic auto-detect:  technical=$is_tech  product=$is_prod
EOF

if (( is_tech == 1 && is_prod == 0 )); then
  cat >&2 <<'EOF'
ACTION: KILL this draft. This is a technical decision the orchestrator must
make autonomously per feedback_decision_classifier + feedback_24_7_bulletproof.
1) Re-read feedback_24_7_bulletproof.md "Decision auto-defaults register".
2) If a default applies, execute it.
3) Otherwise pick the safer-for-security / faster-for-cosmetics option, with
   stop-conditions, and execute.
4) Compose a NEW message that REPORTS what was done. Do not ask.
EOF
  exit 1
fi

if (( is_prod == 1 && is_tech == 0 )); then
  cat >&2 <<'EOF'
NOTE: topic looks product/business. Asking IS allowed there per
feedback_decision_classifier "Product/business/usability topic" section.
But still: prefer "I went with X — say if you want Y" over a blocking question.
Returning code 0 (allow); review framing once more.
EOF
  exit 0
fi

cat >&2 <<'EOF'
AMBIGUOUS: classifier could not determine topic. Re-read the draft and the two
feedback files. If technical, KILL. If product, allow with framing review.
EOF
exit 2
