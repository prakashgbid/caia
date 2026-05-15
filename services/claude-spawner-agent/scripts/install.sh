#!/usr/bin/env bash
# install.sh — render the claude-spawner-agent launchd plist from the template
# and bootstrap it into the user's GUI domain.
#
# This is the canonical installer referenced by the integration-remediation plan
# §B Phase B2 as the post-merge target for Guardrail 7 (the first non-trivial
# proof that the post-merge deployment gate works). It is intentionally
# idempotent: re-running it on a host with the agent already installed is a
# no-op-or-rerender, never a failure.
#
# Usage:
#   bash services/claude-spawner-agent/scripts/install.sh
#
# Or (typically invoked by the post-merge deploy gate):
#   CAIA_REPO=$HOME/caia bash $CAIA_REPO/services/claude-spawner-agent/scripts/install.sh
#
# Environment overrides (all optional; defaults match the M3 convention):
#   CAIA_REPO              repo checkout root          (default $HOME/Documents/projects/caia)
#   SPAWNER_VENV           python venv path            (default $HOME/.caia/spawner-venv)
#   SPAWNER_LOG_DIR        log directory                (default $HOME/Documents/conductor-logs)
#   SLOT_MANAGER_BASE_URL  slot-manager API URL         (default http://stolution.local:8081)
#   CLAUDE_BINARY          claude CLI path              (default /opt/homebrew/bin/claude)
#   ALLOWED_ROOT           add-dir allowlist root      (default $HOME/Documents/projects)
#   NODE_BIN_PATH          PATH prefix that has node    (default /opt/homebrew/bin)
#   DRY_RUN                if non-empty, render only — skip launchctl
#
# Pre-flight (manual or by the gate):
#   1. claude CLI is installed at $CLAUDE_BINARY (e.g. /opt/homebrew/bin/claude).
#   2. python3 is available (3.10+; 3.9 needs eval_type_backport in requirements.txt).
#
# Idempotency contract:
#   - Skips venv creation if the venv exists.
#   - bootout before bootstrap so re-install always picks up the new plist bytes.
#   - kickstart -k at the end so the daemon is forced to reload its module.

set -euo pipefail

# ---------- arg resolution ----------
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$HERE/.." && pwd)"

: "${CAIA_REPO:=$(cd "$SERVICE_DIR/../.." && pwd)}"
: "${SPAWNER_VENV:=$HOME/.caia/spawner-venv}"
: "${SPAWNER_LOG_DIR:=$HOME/Documents/conductor-logs}"
: "${SLOT_MANAGER_BASE_URL:=http://stolution.local:8081}"
: "${CLAUDE_BINARY:=/opt/homebrew/bin/claude}"
: "${ALLOWED_ROOT:=$HOME/Documents/projects}"
: "${NODE_BIN_PATH:=/opt/homebrew/bin}"
: "${DRY_RUN:=}"

LABEL="com.caia.claude-spawner-agent"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENTS_DIR/${LABEL}.plist"
TEMPLATE="$SERVICE_DIR/launchd/${LABEL}.plist.template"

step() { echo ""; echo "==> $*"; }
ok()   { echo "    ✓ $*"; }

step "1/5  Pre-flight"
echo "    caia repo:          $CAIA_REPO"
echo "    service dir:        $SERVICE_DIR"
echo "    plist template:     $TEMPLATE"
echo "    venv:               $SPAWNER_VENV"
echo "    log dir:            $SPAWNER_LOG_DIR"
echo "    slot-manager URL:   $SLOT_MANAGER_BASE_URL"
echo "    claude binary:      $CLAUDE_BINARY"
echo "    allowed root:       $ALLOWED_ROOT"
echo "    node bin path:      $NODE_BIN_PATH"
echo "    dry-run:            ${DRY_RUN:-no}"

[ -f "$TEMPLATE" ] || { echo "    ERR: plist template missing at $TEMPLATE"; exit 2; }
[ -d "$SERVICE_DIR" ] || { echo "    ERR: service dir missing at $SERVICE_DIR"; exit 2; }

step "2/5  Python venv"
if [ ! -x "$SPAWNER_VENV/bin/python" ]; then
  python3 -m venv "$SPAWNER_VENV"
  ok "created venv at $SPAWNER_VENV"
else
  ok "venv exists ($("$SPAWNER_VENV/bin/python" --version 2>&1))"
fi
"$SPAWNER_VENV/bin/pip" install --quiet --upgrade pip wheel >/dev/null
"$SPAWNER_VENV/bin/pip" install --quiet -r "$SERVICE_DIR/requirements.txt"
ok "deps installed"

# Import sanity — catches PEP 604 issues on py3.9 etc.
if ! "$SPAWNER_VENV/bin/python" -c "
import sys
sys.path.insert(0, '$SERVICE_DIR')
import spawner_argv
import local_llm_router_client
import claude_spawner_agent
" 2>&1; then
  echo "    ERR: import-time error; check python version compatibility"
  exit 3
fi
ok "modules import cleanly"

step "3/5  Render plist from template"
mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$SPAWNER_LOG_DIR"

# sed-based template fill. Order matters: placeholder strings must be unique
# enough that earlier substitutions don't pollute later ones. The template
# uses ALL-CAPS placeholders with no surrounding text confusion.
RENDERED_TMP="$(mktemp -t spawner-plist.XXXXXX)"
sed \
  -e "s|CLAUDE_SPAWNER_VENV|${SPAWNER_VENV}|g" \
  -e "s|CLAUDE_SPAWNER_REPO|${CAIA_REPO}|g" \
  -e "s|CLAUDE_SPAWNER_LOG_DIR|${SPAWNER_LOG_DIR}|g" \
  -e "s|SLOT_MANAGER_BASE_URL|${SLOT_MANAGER_BASE_URL}|g" \
  -e "s|CLAUDE_BINARY|${CLAUDE_BINARY}|g" \
  -e "s|ALLOWED_ROOT|${ALLOWED_ROOT}|g" \
  -e "s|NODE_BIN_PATH|${NODE_BIN_PATH}|g" \
  "$TEMPLATE" > "$RENDERED_TMP"

# XML validation — a busted sed substitution should be caught here, not at
# launchctl bootstrap.
if ! python3 -c "import xml.etree.ElementTree as ET; ET.parse('$RENDERED_TMP')"; then
  echo "    ERR: rendered plist is not valid XML; bailing without installing"
  cat "$RENDERED_TMP"
  rm -f "$RENDERED_TMP"
  exit 4
fi
ok "rendered plist parses as XML"

# Only overwrite the installed plist if content changed, to keep mtime stable
# for the deploy gate's "did anything redeploy?" detector.
if [ -f "$PLIST" ] && cmp -s "$RENDERED_TMP" "$PLIST"; then
  ok "installed plist unchanged at $PLIST"
  PLIST_CHANGED=0
else
  mv -f "$RENDERED_TMP" "$PLIST"
  ok "installed plist updated at $PLIST"
  PLIST_CHANGED=1
fi
rm -f "$RENDERED_TMP"

if [ -n "$DRY_RUN" ]; then
  step "4/5  launchctl  [skipped: DRY_RUN]"
  step "5/5  health  [skipped: DRY_RUN]"
  echo ""
  echo "✓ dry-run complete; plist rendered at $PLIST but not loaded"
  exit 0
fi

step "4/5  launchctl bootout → bootstrap → kickstart"
GUI_DOMAIN="gui/$(id -u)"
launchctl bootout "$GUI_DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$GUI_DOMAIN" "$PLIST"
launchctl kickstart -k "$GUI_DOMAIN/$LABEL"
ok "bootstrapped into $GUI_DOMAIN"

step "5/5  Health probe"
sleep 3
# The default port from the plist is 7780; older deploys used 8090. Probe
# both so this script works on either generation.
HEALTH=""
for PORT in 7780 8090; do
  if RESP=$(curl -fsS -m 3 "http://127.0.0.1:$PORT/health" 2>/dev/null); then
    HEALTH="port=$PORT $RESP"
    break
  fi
done
if [ -n "$HEALTH" ]; then
  ok "$HEALTH"
else
  echo "    WARN: /health did not respond on 7780 or 8090 within 3s of kickstart"
  echo "    check logs at: $SPAWNER_LOG_DIR/claude-spawner-agent.{log,err.log}"
  # Don't exit non-zero here — the daemon may take longer to bind on a busy
  # host, and the deploy gate retries health independently.
fi

echo ""
echo "✓ install.sh complete (plist_changed=$PLIST_CHANGED)"
