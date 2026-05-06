#!/usr/bin/env bash
# Install the self-hosted GitHub Actions runner pool on stolution.
#
# Reference: velocity-acceleration-strategy-2026-05-06.md §4.4, §A.2.
#
# Deploys N ephemeral runners as systemd services, each with its own
# /home/s903/actions-runner-{N}/ directory, registered against the
# `prakashgbid` org with labels: self-hosted, stolution, caia, linux.
#
# Prerequisites:
#   - Disk at ≤80% (run scripts/stolution/disk-cleanup.sh first)
#   - GitHub Actions runner registration token, fetched from Vault at
#     secret/stolution/prod/infrastructure/github_runner_registration_token
#     (or passed via $GITHUB_RUNNER_TOKEN env var)
#   - Network egress to api.github.com:443 and pipelines.actions.githubusercontent.com:443
#   - sudo for systemctl (one-time install only)
#
# Operator workflow:
#   1. Run scripts/stolution/disk-cleanup.sh and verify ≤80%
#   2. Fetch a runner registration token (operator-side; via vault helper or GitHub UI)
#   3. ssh stolution
#   4. export GITHUB_RUNNER_TOKEN=<token>
#   5. RUNNER_COUNT=2 bash scripts/stolution/install-runner-pool.sh   # ramp 2 → 4 → 8
#   6. Verify with `systemctl list-units 'actions.runner.caia-*'`
#   7. Confirm runners visible in GitHub Settings → Actions → Runners

set -euo pipefail

RUNNER_VERSION="${RUNNER_VERSION:-2.334.0}"
RUNNER_COUNT="${RUNNER_COUNT:-2}"
RUNNER_USER="${RUNNER_USER:-s903}"
RUNNER_HOME_BASE="/home/${RUNNER_USER}"
ORG_NAME="${GITHUB_ORG:-prakashgbid}"
RUNNER_GROUP="${RUNNER_GROUP:-default}"
TEMPLATE_PATH="${TEMPLATE_PATH:-infra/stolution/systemd/actions.runner.caia.service.template}"
DRY_RUN="${DRY_RUN:-true}"

usage() {
  cat <<USAGE
Usage: $0 [--execute] [--count N] [--user USER] [--org ORG]

  --execute     Actually install and enable the runners (default: dry-run)
  --count N     Number of runners to install (default: 2; ramp 2→4→8 over a week)
  --user USER   Linux user to own the runners (default: s903)
  --org ORG     GitHub org to register against (default: prakashgbid)

Environment:
  GITHUB_RUNNER_TOKEN   Required for --execute. Obtain from Vault at
                        secret/stolution/prod/infrastructure/github_runner_registration_token
                        or from GitHub Settings → Actions → Runners → New runner.
  RUNNER_VERSION        Default: ${RUNNER_VERSION}.

Reference: velocity-acceleration-strategy-2026-05-06.md §4.4, §A.2.
USAGE
}

while (($#)); do
  case "$1" in
    --execute) DRY_RUN=false; shift ;;
    --count) RUNNER_COUNT="$2"; shift 2 ;;
    --user) RUNNER_USER="$2"; RUNNER_HOME_BASE="/home/${RUNNER_USER}"; shift 2 ;;
    --org) ORG_NAME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "::error::unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '[install-runner-pool] %s\n' "$*"; }
banner() { printf '\n=== %s ===\n' "$*"; }

run_or_dry() {
  if "$DRY_RUN"; then log "DRY-RUN: $*"; else log "EXEC: $*"; eval "$@"; fi
}

# ─── preconditions ─────────────────────────────────────────────────────────

banner "preconditions"
log "host:           $(hostname)"
log "runner-version: ${RUNNER_VERSION}"
log "runner-count:   ${RUNNER_COUNT}"
log "runner-user:    ${RUNNER_USER}"
log "github-org:     ${ORG_NAME}"
log "template:       ${TEMPLATE_PATH}"

if [ ! -f "$TEMPLATE_PATH" ]; then
  echo "::error::missing systemd template: $TEMPLATE_PATH" >&2
  echo "  (run from the repository root)" >&2
  exit 1
fi

if ! "$DRY_RUN"; then
  if [ -z "${GITHUB_RUNNER_TOKEN:-}" ]; then
    echo "::error::GITHUB_RUNNER_TOKEN not set" >&2
    echo "  Fetch via:  vault read -field=token secret/stolution/prod/infrastructure/github_runner_registration_token" >&2
    echo "  Or via GitHub UI: Settings → Actions → Runners → New self-hosted runner" >&2
    exit 1
  fi
fi

# Disk check — refuse to run if disk is dangerously full
USE_PCT=$(df --output=pcent / | tail -1 | tr -d ' %')
log "current disk use: ${USE_PCT}%"
if [ "$USE_PCT" -gt 85 ]; then
  echo "::error::disk at ${USE_PCT}% — run scripts/stolution/disk-cleanup.sh first" >&2
  exit 2
fi

# ─── 1. download runner tarball once ───────────────────────────────────────

banner "1. download runner tarball"
TARBALL="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
TARBALL_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"

if [ ! -f "/tmp/${TARBALL}" ]; then
  run_or_dry "curl -sSL -o /tmp/${TARBALL} ${TARBALL_URL}"
else
  log "tarball already present at /tmp/${TARBALL}"
fi

# ─── 2. install N runner instances ─────────────────────────────────────────

for n in $(seq 1 "${RUNNER_COUNT}"); do
  banner "2.${n} install runner caia-${n}"

  RUNNER_DIR="${RUNNER_HOME_BASE}/actions-runner-${n}"
  RUNNER_NAME="caia-stolution-${n}"

  # 2a. unpack into per-runner directory
  if [ ! -d "$RUNNER_DIR" ]; then
    run_or_dry "mkdir -p '$RUNNER_DIR'"
    run_or_dry "tar xzf '/tmp/${TARBALL}' -C '$RUNNER_DIR'"
  else
    log "$RUNNER_DIR already exists; skipping unpack"
  fi

  # 2b. configure (registers with GitHub org)
  if [ ! -f "${RUNNER_DIR}/.runner" ]; then
    run_or_dry "cd '$RUNNER_DIR' && ./config.sh \
      --unattended \
      --url 'https://github.com/${ORG_NAME}' \
      --token \"\$GITHUB_RUNNER_TOKEN\" \
      --name '$RUNNER_NAME' \
      --runnergroup '${RUNNER_GROUP}' \
      --labels 'self-hosted,stolution,caia,linux' \
      --work _work \
      --replace"
  else
    log "${RUNNER_DIR}/.runner already exists; runner already registered"
  fi

  # 2c. render systemd unit
  UNIT_PATH="/etc/systemd/system/actions.runner.caia-${n}.service"
  TMP_UNIT="/tmp/actions.runner.caia-${n}.service"
  sed "s/__N__/${n}/g" "$TEMPLATE_PATH" > "$TMP_UNIT"
  run_or_dry "sudo install -m 0644 '$TMP_UNIT' '$UNIT_PATH'"

  # 2d. enable + start
  run_or_dry "sudo systemctl daemon-reload"
  run_or_dry "sudo systemctl enable --now actions.runner.caia-${n}.service"
done

# ─── 3. verify ─────────────────────────────────────────────────────────────

banner "3. verify"
if "$DRY_RUN"; then
  log "DRY-RUN: skipping verification"
  exit 0
fi

systemctl list-units 'actions.runner.caia-*.service' --no-pager
log "expected runners visible in GitHub Settings → Actions → Runners"
log "DONE"
