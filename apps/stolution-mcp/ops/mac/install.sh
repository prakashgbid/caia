#!/bin/bash
# =============================================================================
# install.sh — Install the Mac-side Vault snapshot puller
#
# Copies pull-stolution-vault-snapshots.sh to ~/bin/ and the LaunchAgent
# plist to ~/Library/LaunchAgents/, with $HOME substituted into the plist.
# Idempotent: safe to re-run after edits.
# =============================================================================

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

readonly SCRIPT_SRC="pull-stolution-vault-snapshots.sh"
readonly PLIST_SRC="com.stolution.vault-snapshot-pull.plist"
readonly SCRIPT_DST="${HOME}/bin/pull-stolution-vault-snapshots.sh"
readonly PLIST_DST="${HOME}/Library/LaunchAgents/com.stolution.vault-snapshot-pull.plist"
readonly LABEL="com.stolution.vault-snapshot-pull"
UID_VAL="$(id -u)"
readonly UID_VAL
readonly DOMAIN="gui/${UID_VAL}"

info() { echo "▶ $*"; }
warn() { echo "⚠ $*" >&2; }

# ─── 1. Install script ────────────────────────────────────────────────────────

mkdir -p "${HOME}/bin"
install -m 0755 "$SCRIPT_SRC" "$SCRIPT_DST"
info "installed $SCRIPT_DST"

# ─── 2. Install plist with $HOME substituted ──────────────────────────────────

mkdir -p "${HOME}/Library/LaunchAgents"
mkdir -p "${HOME}/Library/Logs"
mkdir -p "${HOME}/Library/Application Support/Stolution/vault-snapshots"

# sed with a delimiter that won't collide with paths
sed "s|__HOME__|${HOME}|g" "$PLIST_SRC" > "$PLIST_DST"
chmod 0644 "$PLIST_DST"
info "installed $PLIST_DST"

# ─── 3. Reload the LaunchAgent ────────────────────────────────────────────────

# Use the modern bootstrap/bootout API (macOS Big Sur+). Fall back to load -w
# only if bootstrap is unavailable on a very old macOS.
if launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null; then
  info "evicted previous instance"
fi

if launchctl bootstrap "${DOMAIN}" "$PLIST_DST" 2>/dev/null; then
  info "bootstrapped LaunchAgent ${LABEL}"
else
  # Older macOS — use the legacy API
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  launchctl load -w "$PLIST_DST"
  info "loaded (legacy) LaunchAgent ${LABEL}"
fi

# ─── 4. Verify it's registered ────────────────────────────────────────────────

# Allow a moment for launchd to register before we check
sleep 1

if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  info "✅ ${LABEL} registered with launchd"
else
  warn "${LABEL} not visible to launchctl print — investigate"
  exit 1
fi

cat <<EOF

Installed.
  Script:      ${SCRIPT_DST}
  Plist:       ${PLIST_DST}
  Local snaps: ${HOME}/Library/Application Support/Stolution/vault-snapshots/
  Log:         ${HOME}/Library/Logs/stolution-vault-snapshot-pull.log

Next runs will fire daily at 03:30 local.
Trigger a manual run with:
  launchctl kickstart ${DOMAIN}/${LABEL}
Tail the log with:
  tail -f "${HOME}/Library/Logs/stolution-vault-snapshot-pull.log"
EOF
