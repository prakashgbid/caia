#!/usr/bin/env bash
# claude-spawner-agent smoke test.
#
# Runs:
#   1. python -m py_compile on every source module.
#   2. com.caia.claude-spawner-agent.plist.template parses as XML.
#   3. each module imports (spawner_argv → local_llm_router_client → claude_spawner_agent).
#
# Used by .github/workflows/services-smoke.yml on every PR that touches
# services/claude-spawner-agent/**.
#
# Local invocation:
#   cd services/claude-spawner-agent
#   pip install -r requirements.txt
#   bash smoke.sh

set -euo pipefail

cd "$(dirname "$0")"

echo "==> py_compile sources"
for f in claude_spawner_agent.py local_llm_router_client.py spawner_argv.py; do
  python3 -m py_compile "$f"
  echo "    ✓ $f"
done

echo "==> plist template XML sanity"
test -s com.caia.claude-spawner-agent.plist.template || {
  echo "    ✗ plist template missing or empty"; exit 1; }
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("com.caia.claude-spawner-agent.plist.template")
print("    ✓ plist template parses as XML")
PY

echo "==> import smoke"
# claude_spawner_agent imports `from spawner_argv import build_claude_argv`
# and `from local_llm_router_client import (…)`. cwd-based PYTHONPATH lets the
# imports resolve against the sibling files in this directory.
PYTHONPATH=".:${PYTHONPATH:-}" python3 -c "
import spawner_argv
import local_llm_router_client
import claude_spawner_agent
print('    ✓ spawner_argv imports')
print('    ✓ local_llm_router_client imports')
print('    ✓ claude_spawner_agent imports')
"

echo ""
echo "claude-spawner-agent smoke: PASS"
