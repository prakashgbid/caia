#!/bin/bash
# install_m1_spawner.sh — full M1 claude-spawner-agent install.
#
# Designed for the M1 spawner deployment 2026-05-14. Runs on M1 in an INTERACTIVE
# Terminal session as the MAC user. Pulls the deployment bundle from M3 over SSH
# (M1→M3 SSH works fine), installs the agent, builds a venv, registers + bootstraps
# the launchd plist into the gui/ domain (REQUIRED for keychain inheritance so the
# spawned claude subprocess can read the `Claude Code-credentials-*` keychain entries).
#
# Why interactive Terminal: `launchctl bootstrap gui/$(id -u)` only inherits keychain
# access when invoked from a process that's IN the GUI session. SSH-launched commands
# typically aren't, which is why the M3-side autonomous worker (this script's author)
# cannot run this remotely.
#
# Usage on M1:
#   curl -fsSL ... | bash      # if hosted somewhere accessible; OR
#   scp macbook-pro:/Users/macbook32/Documents/projects/reports/claude-spawner-agent/m1-deployment-bundle/install_m1_spawner.sh /tmp/
#   bash /tmp/install_m1_spawner.sh
#
# Idempotent: safe to re-run. Each step checks current state and skips if already done.

set -euo pipefail

MAC_HOME="/Users/MAC"
INSTALL_DIR="$MAC_HOME/.caia/spawner"
VENV="$INSTALL_DIR/venv"
LAUNCH_AGENTS="$MAC_HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENTS/com.caia.claude-spawner-agent.plist"
LABEL="com.caia.claude-spawner-agent"
BUNDLE_REMOTE="macbook-pro:/Users/macbook32/Documents/projects/reports/claude-spawner-agent/m1-deployment-bundle"
PORT=8090

step() { echo ""; echo "==> $*"; }

step "1/7  Verify host identity"
HN=$(hostname)
echo "    hostname=$HN  user=$(whoami)  $(uname -srm)"
[ "$(whoami)" = "MAC" ] || { echo "    ERROR: must run as MAC user (currently $(whoami))"; exit 1; }

step "2/7  Pull deployment bundle from M3"
mkdir -p "$INSTALL_DIR"
scp "$BUNDLE_REMOTE/claude_spawner_agent.py" "$INSTALL_DIR/claude_spawner_agent.py"
scp "$BUNDLE_REMOTE/requirements.txt"        "$INSTALL_DIR/requirements.txt"
scp "$BUNDLE_REMOTE/schema.sql"              "$INSTALL_DIR/schema.sql"
scp "$BUNDLE_REMOTE/com.caia.claude-spawner-agent.plist" "$PLIST"
ls -la "$INSTALL_DIR"

step "3/7  Build Python venv + install deps"
# NOTE: M1 has /usr/bin/python3 = 3.9.6. The agent uses PEP 604 `str | None` union syntax
# (Python 3.10+) at module top-level — it crashes at import on 3.9 unless `eval_type_backport`
# is installed. That backport is in requirements.txt; the install below resolves it. If you
# re-spin this script on a host with Python ≥ 3.10, the backport install is a harmless no-op.
if [ ! -x "$VENV/bin/python" ]; then
  /usr/bin/python3 -m venv "$VENV"
  echo "    venv created at $VENV"
fi
"$VENV/bin/python" --version
"$VENV/bin/pip" install --quiet --upgrade pip wheel
"$VENV/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"
echo "    installed:"
"$VENV/bin/pip" freeze | head -10
# Sanity-check: does the agent even import cleanly on this Python? (catches PEP 604 issues, etc.)
if ! "$VENV/bin/python" -c "import sys; sys.path.insert(0, '$INSTALL_DIR'); import claude_spawner_agent" 2>&1 | head -3; then
  echo "    NOTE: import-time error above — the backport may not have applied. On Python 3.9, set PYTHONSTARTUP or apply eval_type_backport.activate() at module top. See bundle README."
fi

step "4/7  Verify claude CLI present + show version"
ls -la /Users/MAC/.local/bin/claude
/Users/MAC/.local/bin/claude --version

step "5/7  Smoke-test the agent runs (foreground, 5s) — proves Python deps resolve + port binds"
# Run the agent for 5s in the foreground; SIGTERM after.
# This catches missing deps / port conflicts BEFORE we hand it to launchd.
( cd "$INSTALL_DIR" && \
  PORT="$PORT" HOST_NAME="mac-m1" CLAUDE_BINARY="/Users/MAC/.local/bin/claude" \
  ALLOWED_ROOT="/Users/MAC" HOME="$MAC_HOME" \
  "$VENV/bin/python" claude_spawner_agent.py ) &
SMOKE_PID=$!
sleep 5
if kill -0 $SMOKE_PID 2>/dev/null; then
  echo "    agent stayed up for 5s — OK"
  # Probe healthz / version before killing
  curl -s -m 2 "http://localhost:$PORT/health" 2>&1 | head -3 || true
  curl -s -m 2 "http://localhost:$PORT/version" 2>&1 | head -3 || true
  kill $SMOKE_PID 2>/dev/null || true
  wait $SMOKE_PID 2>/dev/null || true
else
  echo "    ERROR: agent exited within 5s; check logs above"
  exit 4
fi

step "6/7  Bootstrap launchd plist into GUI domain"
mkdir -p "$LAUNCH_AGENTS"
# Unload first if already loaded (idempotent re-install)
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "    bootstrapped — checking status:"
launchctl print "gui/$(id -u)/$LABEL" 2>&1 | head -20 || launchctl list | grep claude-spawner-agent

step "7/7  Healthz probe (local + Tailscale)"
sleep 3
echo "    localhost  : $(curl -s -m 3 http://localhost:$PORT/health 2>&1 | head -c 400)"
echo ""
echo "    From M3, the operator can verify with:"
echo "    curl -s http://100.90.12.37:$PORT/health"
echo ""
echo "✓ M1 spawner deployment complete."
echo ""
echo "Logs: ~/Library/Logs/claude-spawner-agent.log"
echo ""
echo "Next: from M3, the chain-runner will dispatch a smoke spawn via"
echo "  ~/.caia/chain-watchdog/spawner_dispatch.sh ... m1 ..."
echo "If the smoke returns api_error_status=401, run on M1:"
echo "  /Users/MAC/.local/bin/claude /login    # or  setup-token"
echo "(same OAuth-expiry pattern observed on stolution)"
