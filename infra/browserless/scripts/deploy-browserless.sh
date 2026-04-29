#!/usr/bin/env bash
# =============================================================================
# scripts/deploy-browserless.sh
#
# One-shot deploy + reconcile for Browserless on the stolution remote.
# Idempotent: safe to re-run.
#
# Steps:
#   1. SSH to stolution
#   2. Sync infra/browserless/docker-compose.yml -> ~/stolution/docker-compose.browserless.yml
#   3. Render .env from Vault (BROWSERLESS_TOKEN secret)
#   4. docker compose pull && up -d
#   5. Run healthcheck.sh; abort on failure
#
# This script is referenced by the runbook (infra/browserless/README.md).
# It is NOT invoked from CI today — deploys are operator-initiated until
# we land FIX-013's auto-reconciler.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BROWSERLESS_DIR="${REPO_ROOT}/infra/browserless"
SSH_HOST="${STOLUTION_SSH_HOST:-stolution}"
# shellcheck disable=SC2088
# Tilde is expanded by the *remote* login shell over ssh, not locally; we
# pass the literal '~/stolution' so the remote home is resolved correctly
# regardless of the operator local username.
REMOTE_DIR='~/stolution'


log() { printf '[deploy-browserless] %s\n' "$*"; }
fail() { printf '[deploy-browserless] FAIL: %s\n' "$*" >&2; exit 1; }

# ---- 1. Preflight ----------------------------------------------------------

[[ -f "${BROWSERLESS_DIR}/docker-compose.yml" ]] \
  || fail "missing ${BROWSERLESS_DIR}/docker-compose.yml"

[[ -f "${BROWSERLESS_DIR}/healthcheck.sh" ]] \
  || fail "missing ${BROWSERLESS_DIR}/healthcheck.sh"

ssh -o BatchMode=yes "$SSH_HOST" 'true' \
  || fail "cannot ssh to ${SSH_HOST}"

# ---- 2. Sync compose file --------------------------------------------------

log "syncing docker-compose.yml to ${SSH_HOST}:${REMOTE_DIR}/docker-compose.browserless.yml"
scp -q "${BROWSERLESS_DIR}/docker-compose.yml" \
       "${SSH_HOST}:${REMOTE_DIR}/docker-compose.browserless.yml"

# ---- 3. Render .env from Vault --------------------------------------------

log "rendering .env from Vault secret/stolution/prod/browserless"
ssh "$SSH_HOST" bash <<'REMOTE_EOF'
  set -euo pipefail
  ROLE_ID=$(grep ^ROLE_ID= ~/.stolution-vault/claude-orchestrator-approle.env | cut -d= -f2 | tr -d '[:space:]')
  SECRET_ID=$(grep ^SECRET_ID= ~/.stolution-vault/claude-orchestrator-approle.env | cut -d= -f2 | tr -d '[:space:]')
  ADMIN=$(cat ~/.stolution-vault/vault-admin-token.txt)
  SESSION=$(docker exec -e VAULT_TOKEN="$ADMIN" stolution-vault \
              vault write -field=token auth/approle/login \
              role_id="$ROLE_ID" secret_id="$SECRET_ID")
  TOKEN=$(docker exec -e VAULT_TOKEN="$SESSION" stolution-vault \
            vault kv get -field=token secret/stolution/prod/browserless 2>/dev/null \
          || true)
  if [[ -z "$TOKEN" ]]; then
    # First-run bootstrap: generate a random token and store it.
    TOKEN=$(openssl rand -hex 32)
    docker exec -e VAULT_TOKEN="$ADMIN" stolution-vault \
      vault kv put secret/stolution/prod/browserless token="$TOKEN" >/dev/null
    echo "[deploy] minted new BROWSERLESS_TOKEN and stored in vault"
  fi
  printf 'BROWSERLESS_TOKEN=%s\n' "$TOKEN" > ~/stolution/.env.browserless
  chmod 600 ~/stolution/.env.browserless
REMOTE_EOF

# ---- 4. compose pull + up -------------------------------------------------

log "pulling image + bringing container up on ${SSH_HOST}"
ssh "$SSH_HOST" bash <<'REMOTE_EOF'
  set -euo pipefail
  cd ~/stolution
  docker compose --env-file .env.browserless \
                 -f docker-compose.browserless.yml pull
  docker compose --env-file .env.browserless \
                 -f docker-compose.browserless.yml up -d
REMOTE_EOF

# ---- 5. Healthcheck (give container 30s warm-up) ---------------------------

log "waiting for container to become ready"
sleep 30

log "running healthcheck.sh on ${SSH_HOST}"
ssh "$SSH_HOST" bash -s < "${BROWSERLESS_DIR}/healthcheck.sh"

log "deploy successful — Browserless live on ${SSH_HOST}:127.0.0.1:13000"
