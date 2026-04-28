#!/bin/bash
# Conductor — full build and test runner
# Run from: /Users/MAC/Documents/projects/conductor/

set -e
cd "$(dirname "$0")"

echo "=== Conductor Build + Test ==="
echo ""

# Install root deps
echo "1. Installing root dependencies..."
npm install

# Run unit tests (should be RED before implementation, GREEN after)
echo ""
echo "2. Running unit tests..."
npm test -- --forceExit 2>&1

# Type check
echo ""
echo "3. TypeScript check..."
npm run typecheck 2>&1

# Build
echo ""
echo "4. Building..."
npm run build 2>&1

# Verify CLI
echo ""
echo "5. CLI smoke test..."
node dist/cli/index.js --version

# Health endpoint test
echo ""
echo "6. MCP server + health check..."
node dist/cli/index.js mcp &
MCP_PID=$!
sleep 2

HEALTH=$(curl -sf http://localhost:7776/health 2>/dev/null || echo '{"ok":false}')
echo "Health: $HEALTH"

kill $MCP_PID 2>/dev/null || true

# Dashboard
echo ""
echo "7. Installing dashboard deps..."
cd dashboard && npm install && npm run build
cd ..

echo ""
echo "=== All done ==="
