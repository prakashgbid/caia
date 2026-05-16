#!/usr/bin/env bash
#
# audit-spawn-prefix.sh — drift detector. Verifies that recent spawned tasks
# included the Standing-Rule Sentinel block. Pure local. Zero Claude tokens.
#
# Runs every 10 min via cron / LaunchAgent. If drift is detected, writes an
# anomaly marker that the Thin Alerter surfaces to the operator.
#
# What it checks:
#   1. Every Cowork session JSONL modified in the last 30 min has the
#      'STANDING-RULE-SENTINEL v2' marker in the first ~8 KB of context.
#   2. The pre-send-classifier.sh exists and is executable.
#   3. decision_defaults.yaml exists and parses as YAML.
#
# Anomaly marker format:
#   ~/.cache/orchestrator/audit_anomaly  (JSON list of issues)

set -euo pipefail

CACHE="${HOME}/.cache/orchestrator"
mkdir -p "$CACHE"

issues=()

# 1) Sentinel drift check.
for d in \
    "${HOME}/Library/Application Support/Claude/local-agent-mode-sessions" \
    "${HOME}/.claude/projects" ; do
  [[ -d "$d" ]] || continue
  while IFS= read -r jsonl; do
    if ! head -c 8192 "$jsonl" | grep -q 'STANDING-RULE-SENTINEL v2'; then
      issues+=("sentinel_drift:$(basename "$jsonl")")
    fi
  done < <(find "$d" -type f -name '*.jsonl' -mmin -30 2>/dev/null | head -n50)
done

# 2) Classifier exists?
CLASSIFIER="${HOME}/Documents/projects/caia/scripts/orchestrator/pre-send-classifier.sh"
if [[ ! -x "$CLASSIFIER" ]]; then
  issues+=("classifier_missing_or_not_executable:$CLASSIFIER")
fi

# 3) decision_defaults.yaml parses?
DEFAULTS="${HOME}/Documents/projects/caia/scripts/orchestrator/decision_defaults.yaml"
if ! python3 -c "import yaml; yaml.safe_load(open('$DEFAULTS'))" 2>/dev/null; then
  issues+=("decision_defaults_yaml_invalid_or_missing")
fi

# Write or clear marker.
if (( ${#issues[@]} > 0 )); then
  printf '{\n  "ts": "%s",\n  "kind": "audit_drift",\n  "issues": [\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CACHE/audit_anomaly"
  for i in "${!issues[@]}"; do
    sep=","; (( i == ${#issues[@]} - 1 )) && sep=""
    printf '    "%s"%s\n' "${issues[$i]}" "$sep" >> "$CACHE/audit_anomaly"
  done
  printf '  ]\n}\n' >> "$CACHE/audit_anomaly"
fi
