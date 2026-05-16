#!/usr/bin/env bash
#
# ollama-semantic-classifier.sh — adjudicates "ambiguous" pre-send-classifier
# results using a LOCAL LLM on stolution. Zero Claude tokens.
#
# Background: pre-send-classifier.sh exits with code 2 ("AMBIGUOUS") when it
# finds banned phrasing but cannot determine if the topic is technical or
# product. Rather than escalating to a Claude session (which would be
# expensive and lose the local-first property), we delegate to Ollama.
#
# Model: qwen2.5:7b (already on stolution per memory). Response is a single
# token "TECHNICAL" or "PRODUCT".
#
# Cost: $0. ~2 GB RAM resident on stolution. Latency ~500 ms per call.
#
# Input: drafts captured by pre-send-classifier when it exits 2. The
# orchestrator pipes ambiguous drafts to a queue file:
#     ~/.cache/orchestrator/ambiguous_drafts/
# (one file per ambiguous draft; each contains the raw draft text)
#
# Output:
#   if TECHNICAL → write block_<id>.json marker the alerter reads + the
#                  orchestrator MUST kill the draft
#   if PRODUCT   → write allow_<id>.json marker; draft can be sent
#
# This script runs every 30 min via stolution cron.

set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434/api/generate}"
MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
QUEUE_DIR="${HOME}/.cache/orchestrator/ambiguous_drafts"
RESULTS_DIR="${HOME}/.cache/orchestrator/classifier_results"
mkdir -p "$QUEUE_DIR" "$RESULTS_DIR"

# Quick health check — if Ollama is down, exit silently. The drafts will be
# re-queued next tick.
if ! curl -fsS --max-time 2 "${OLLAMA_URL%/api/generate}/api/tags" >/dev/null 2>&1; then
  echo "[ollama-classifier] Ollama unreachable; deferring" >&2
  exit 0
fi

PROMPT_PREFIX='You are a binary classifier. The input is a draft message an autonomous
AI orchestrator is about to send to its operator. Decide if the topic is:

  TECHNICAL  - code, CI, dependencies, infrastructure, branches, PRs, tools,
               architecture, migrations, refactors. The operator does NOT
               make these decisions.
  PRODUCT    - product direction, target customer, brand voice, business
               strategy, pricing, feature priority. The operator IS the
               unique source of truth.

Reply with ONLY the word TECHNICAL or PRODUCT. No explanation. No punctuation.

Draft:
"""
'

PROMPT_SUFFIX='
"""

Topic:'

for draft in "$QUEUE_DIR"/*; do
  [[ -f "$draft" ]] || continue
  id=$(basename "$draft")

  # Build the request payload (jq for safety with quotes/newlines)
  payload=$(jq -n \
    --arg model "$MODEL" \
    --arg prompt "$PROMPT_PREFIX$(cat "$draft")$PROMPT_SUFFIX" \
    '{ model: $model, prompt: $prompt, stream: false }')

  result=$(curl -fsS --max-time 20 "$OLLAMA_URL" -d "$payload" \
           | jq -r '.response' \
           | tr '[:lower:]' '[:upper:]' \
           | grep -oE 'TECHNICAL|PRODUCT' \
           | head -n1 || echo "UNKNOWN")

  case "$result" in
    TECHNICAL)
      printf '{"id":"%s","decision":"BLOCK","reason":"technical-topic-must-not-ask"}\n' "$id" \
        > "$RESULTS_DIR/block_${id}.json"
      ;;
    PRODUCT)
      printf '{"id":"%s","decision":"ALLOW","reason":"product-topic-asking-acceptable"}\n' "$id" \
        > "$RESULTS_DIR/allow_${id}.json"
      ;;
    *)
      printf '{"id":"%s","decision":"UNKNOWN","raw":"%s"}\n' "$id" "$result" \
        > "$RESULTS_DIR/unknown_${id}.json"
      ;;
  esac

  rm -f "$draft"  # done; remove from queue
done
