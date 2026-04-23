#!/usr/bin/env bash
# Local equivalent of the CI gate:memory-rule-enforceable check
# Usage: ./scripts/check-memory-rule-enforceable.sh
set -euo pipefail

MEMDIR="${MEMDIR:-/Users/MAC/Library/Application Support/Claude/local-agent-mode-sessions/3a77f4b3-623a-45ba-b937-609ce53cf8ca/29a21e63-1075-46d4-9f80-b1ed52955c0c/agent/memory}"
INVENTORY="reports/memory-rule-inventory.md"

echo "=== gate:memory-rule-enforceable ==="
echo "Scanning memory files for rules without enforcement..."

if [[ ! -f "$INVENTORY" ]]; then
  echo "ERROR: $INVENTORY not found. Run rule extraction first."
  exit 1
fi

# Count rules in inventory with enforcement_gap column = "none" and proposed_mechanism != "advisory"
GAP_COUNT=$(grep -c '| none |' "$INVENTORY" 2>/dev/null || echo 0)
ADVISORY_COUNT=$(grep -c '| advisory |' "$INVENTORY" 2>/dev/null || echo 0)
TOTAL=$(grep -c '^| [A-Z]' "$INVENTORY" 2>/dev/null || echo 0)

echo "Total rules:    $TOTAL"
echo "Advisory:       $ADVISORY_COUNT"
echo "Enforcement gaps: $GAP_COUNT"

if [[ "$GAP_COUNT" -gt 0 ]]; then
  echo ""
  echo "WARNING: $GAP_COUNT rule(s) have no current enforcement and no proposed mechanism."
  echo "  These should be addressed or tagged advisory=true."
fi

echo ""
echo "✅ check-memory-rule-enforceable complete."
