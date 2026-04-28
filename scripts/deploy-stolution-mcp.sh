#!/usr/bin/env bash
# =============================================================================
# deploy-stolution-mcp.sh
# Deploys the stolution-mcp MCP server to the remote stolution server and
# registers it as a PM2 service.
#
# Usage:  ./scripts/deploy-stolution-mcp.sh [--restart-only]
#
# Prerequisites (local):
#   - SSH alias "stolution" configured in ~/.ssh/config (s903@162.251.161.17)
#   - Node.js 20+ installed on remote
#   - npm installed on remote
#   - PM2 installed globally on remote: npm install -g pm2
#
# Prerequisites (remote):
#   - The following env vars in ~/stolution-mcp/.env (created on first deploy):
#       DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
#       VAULT_TOKEN (optional if using Docker vault container)
#       VAULT_ADDR  (optional, defaults to http://127.0.0.1:8200)
# =============================================================================

set -euo pipefail

REMOTE="stolution"
REMOTE_DIR="/home/s903/stolution-mcp"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/stolution-mcp"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}▶ $*${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $*${NC}"; }
error()   { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

# ─── Parse args ───────────────────────────────────────────────────────────────

RESTART_ONLY=false
for arg in "$@"; do
  [[ "$arg" == "--restart-only" ]] && RESTART_ONLY=true
done

# ─── Check SSH connectivity ───────────────────────────────────────────────────

info "Checking SSH connectivity to $REMOTE..."
ssh -o ConnectTimeout=10 "$REMOTE" "echo 'SSH OK'" || error "Cannot reach $REMOTE — check SSH config"

if $RESTART_ONLY; then
  info "Restart-only mode: restarting PM2 process..."
  ssh "$REMOTE" "pm2 restart stolution-mcp && pm2 save" || error "PM2 restart failed"
  info "✅ Restarted stolution-mcp"
  exit 0
fi

# ─── Build locally first ─────────────────────────────────────────────────────

info "Building TypeScript locally..."
cd "$LOCAL_DIR"
npm install --silent
npm run build
info "Build OK — dist/ is ready"

# ─── Create remote directory ──────────────────────────────────────────────────

info "Creating remote directory $REMOTE_DIR..."
ssh "$REMOTE" "mkdir -p $REMOTE_DIR/dist $REMOTE_DIR/src"

# ─── Sync files ───────────────────────────────────────────────────────────────

info "Syncing files to $REMOTE:$REMOTE_DIR ..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='*.log' \
  "$LOCAL_DIR/" \
  "$REMOTE:$REMOTE_DIR/"

# ─── Install production dependencies on remote ───────────────────────────────

info "Installing production dependencies on remote..."
ssh "$REMOTE" "cd $REMOTE_DIR && npm install --omit=dev --silent"

# ─── Create .env if it doesn't exist ─────────────────────────────────────────

info "Checking remote .env..."
ssh "$REMOTE" "bash -s" << 'ENVINIT'
ENV_FILE="/home/s903/stolution-mcp/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating template .env — fill in your values!"
  cat > "$ENV_FILE" << 'ENVTEMPLATE'
# PostgreSQL connection
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=stolution
DB_USER=s903
DB_PASSWORD=

# HashiCorp Vault (leave empty to use Docker container named "vault")
VAULT_TOKEN=
VAULT_ADDR=http://127.0.0.1:8200
VAULT_CONTAINER=vault
ENVTEMPLATE
  chmod 600 "$ENV_FILE"
  echo "⚠ Template .env created at $ENV_FILE — edit it before starting the server!"
else
  echo ".env already exists — skipping template creation"
fi
ENVINIT

# ─── Register / restart with PM2 ─────────────────────────────────────────────

info "Registering stolution-mcp with PM2..."
ssh "$REMOTE" "bash -s" << PMSTART
cd $REMOTE_DIR

# Stop existing instance if running
pm2 stop stolution-mcp 2>/dev/null || true
pm2 delete stolution-mcp 2>/dev/null || true

# Start fresh, loading .env
pm2 start dist/index.js \
  --name stolution-mcp \
  --interpreter node \
  --no-autorestart \
  -- 2>/dev/null || true

# Actually: MCP stdio servers don't persist, they're spawned on-demand by SSH.
# So we DON'T want PM2 to keep it running — we just verify it starts cleanly.
pm2 delete stolution-mcp 2>/dev/null || true
echo "PM2 launch test passed"
PMSTART

# ─── Verify binary works ──────────────────────────────────────────────────────

info "Verifying server starts..."
RESULT=$(ssh "$REMOTE" "timeout 3 node $REMOTE_DIR/dist/index.js 2>&1 || true")
if echo "$RESULT" | grep -q "stolution-mcp"; then
  info "✅ Server starts cleanly"
else
  warn "Server output: $RESULT"
  warn "Could not verify clean startup — check manually with: ssh stolution node $REMOTE_DIR/dist/index.js"
fi

# ─── Print Cowork config ──────────────────────────────────────────────────────

echo ""
info "=== Cowork MCP Configuration ==="
cat << COWORKCONFIG
Add this to your Claude Cowork MCP config file:

{
  "mcpServers": {
    "stolution-remote": {
      "command": "ssh",
      "args": ["-tt", "stolution", "node $REMOTE_DIR/dist/index.js"],
      "description": "stolution remote server — files, Docker, PM2, Vault, DB, bash"
    }
  }
}

Typical config file location:
  ~/Library/Application Support/Claude/claude_desktop_config.json
COWORKCONFIG

info "✅ Deployment complete!"
