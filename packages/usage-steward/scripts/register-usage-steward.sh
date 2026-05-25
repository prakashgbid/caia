#!/usr/bin/env bash
# Register @caia/usage-steward with launchd on the local Mac.
#
# Idempotent: unloads the previous plist (if any), re-installs, reloads.
# Sets up log directories. Doesn't run pnpm install — assumes the
# operator has already done `pnpm install` at the workspace root and
# the package's `dist/` exists.
set -Eeuo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="${PKG_DIR}/launchd/com.caia.usage-steward-hourly.plist"
LAUNCH_AGENTS="${HOME}/Library/LaunchAgents"
PLIST_DST="${LAUNCH_AGENTS}/com.caia.usage-steward-hourly.plist"
LOG_DIR="${HOME}/Library/Logs/caia"
DATA_DIR="${HOME}/.caia/usage-steward"

echo "==> register-usage-steward"
echo "    pkg:  ${PKG_DIR}"
echo "    src:  ${PLIST_SRC}"
echo "    dst:  ${PLIST_DST}"

# ── Pre-flight ──────────────────────────────────────────────────────────────
if [[ ! -f "${PLIST_SRC}" ]]; then
  echo "ERROR: plist source not found: ${PLIST_SRC}" >&2
  exit 1
fi
if [[ ! -d "${PKG_DIR}/dist" ]]; then
  echo "ERROR: ${PKG_DIR}/dist is missing — run 'pnpm --filter @caia/usage-steward build' first" >&2
  exit 1
fi
if [[ ! -x "${PKG_DIR}/bin/usage-steward-run" ]]; then
  chmod +x "${PKG_DIR}/bin/usage-steward-run"
fi

mkdir -p "${LAUNCH_AGENTS}" "${LOG_DIR}" "${DATA_DIR}"

# ── Unload prior (idempotent — ignore if absent) ───────────────────────────
if launchctl list | grep -q 'com.caia.usage-steward-hourly'; then
  echo "==> unloading previous launchd entry"
  launchctl bootout "gui/$(id -u)" "${PLIST_DST}" 2>/dev/null || true
fi
if [[ -f "${PLIST_DST}" ]]; then
  rm -f "${PLIST_DST}"
fi

# ── Install ────────────────────────────────────────────────────────────────
echo "==> installing plist"
cp "${PLIST_SRC}" "${PLIST_DST}"

# ── Load ───────────────────────────────────────────────────────────────────
echo "==> loading"
launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}"
launchctl kickstart -k "gui/$(id -u)/com.caia.usage-steward-hourly"

echo "==> done."
echo "    Logs: ${LOG_DIR}/usage-steward.{out,err}.log"
echo "    Data: ${DATA_DIR}/{runs.jsonl,status.json,attestations.jsonl}"
echo "    Disable: launchctl bootout gui/\$(id -u) ${PLIST_DST}"
