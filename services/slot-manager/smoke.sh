#!/usr/bin/env bash
# slot-manager smoke test.
#
# Runs:
#   1. python -m py_compile on slot_manager.py
#   2. schema.sql applies to an empty SQLite (in-memory) DB; required tables present.
#   3. module import (uses cwd-resident schema.sql + tmp DB so apply_schema can run).
#
# Used by .github/workflows/services-smoke.yml on every PR that touches
# services/slot-manager/**.
#
# Local invocation:
#   cd services/slot-manager
#   pip install -r requirements.txt
#   bash smoke.sh

set -euo pipefail

cd "$(dirname "$0")"

echo "==> py_compile slot_manager.py"
python3 -m py_compile slot_manager.py
echo "    ✓ syntax ok"

echo "==> schema sanity"
test -s schema.sql || { echo "    ✗ schema.sql missing or empty"; exit 1; }
python3 - <<'PY'
import sqlite3, pathlib
sql = pathlib.Path("schema.sql").read_text()
conn = sqlite3.connect(":memory:")
conn.executescript(sql)
tables = sorted(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"))
required = {"slots", "assignments", "events", "spawn_log"}
missing = required - set(tables)
assert not missing, f"missing required tables: {missing} (have {tables})"
print(f"    ✓ schema applies; tables: {tables}")
PY

echo "==> import smoke"
TMP_DB=$(mktemp --suffix=.db)
trap 'rm -f "$TMP_DB"' EXIT
SCHEMA_PATH="$(pwd)/schema.sql" \
SLOT_MANAGER_DB_PATH="$TMP_DB" \
  python3 -c "import slot_manager; print('    ✓ slot_manager imports')"

echo ""
echo "slot-manager smoke: PASS"
