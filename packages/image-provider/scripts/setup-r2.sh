#!/bin/bash
# Complete Cloudflare R2 setup once R2 is enabled in the dashboard.
# Run this AFTER going to dash.cloudflare.com → R2 → "Get started" / "Enable R2".
# Usage: bash scripts/setup-r2.sh
set -euo pipefail

STOLUTION="stolution"
VAULT_DIR="/home/s903/.vault"
BUCKET_NAME="site-images"

log()  { printf '\033[0;36m[setup-r2]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[0;31m[setup-r2] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

log "running R2 setup on $STOLUTION..."
ssh "$STOLUTION" 'bash /tmp/cf-r2-setup.sh 2>&1' || fail "R2 setup script failed — see errors above"

# Pull results from stolution
log "pulling R2 credentials..."
CF_ACCOUNT=$(ssh "$STOLUTION" "awk -F= '/^CF_ACCOUNT_ID=/{print \$2}' /tmp/cf-r2-result.env" || echo "")
R2_KEY_ID=$(ssh "$STOLUTION" "awk -F= '/^R2_ACCESS_KEY_ID=/{print \$2}' /tmp/cf-r2-result.env" || echo "")
R2_SECRET=$(ssh "$STOLUTION" "awk -F= '/^R2_SECRET_ACCESS_KEY=/{print \$2}' /tmp/cf-r2-result.env" || echo "")
R2_DOMAIN=$(ssh "$STOLUTION" "awk -F= '/^R2_PUBLIC_DOMAIN=/{print \$2}' /tmp/cf-r2-result.env" || echo "")

[ -n "$CF_ACCOUNT" ] || fail "CF_ACCOUNT_ID not set in result — R2 setup may not have completed"
[ -n "$R2_KEY_ID"  ] || fail "R2_ACCESS_KEY_ID not set — R2 token creation may have failed"
[ -n "$R2_SECRET"  ] || fail "R2_SECRET_ACCESS_KEY not set — R2 token creation may have failed"

log "account_id:   ${#CF_ACCOUNT} chars"
log "access_key:   ${#R2_KEY_ID} chars"
log "secret:       ${#R2_SECRET} chars"
log "public_url:   https://$R2_DOMAIN"

# Store in vault
log "storing R2 creds in vault..."
ssh "$STOLUTION" "cat > $VAULT_DIR/image-provider-cloudflare-r2.env << VEOF
# image-provider: Cloudflare R2 credentials
# Stored: \$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Scope: R2 bucket $BUCKET_NAME read+write (scoped API token)
CLOUDFLARE_ACCOUNT_ID=$CF_ACCOUNT
R2_ACCESS_KEY_ID=$R2_KEY_ID
R2_SECRET_ACCESS_KEY=$R2_SECRET
R2_BUCKET=$BUCKET_NAME
R2_PUBLIC_BASE_URL=https://$R2_DOMAIN
VEOF
chmod 600 $VAULT_DIR/image-provider-cloudflare-r2.env
echo 'vault updated'"

log "R2 vault entry updated"

# Re-pull all secrets into local .env
log "pulling all secrets into .env..."
bash "$(dirname "${BASH_SOURCE[0]}")/pull-secrets.sh"

# Clean up stolution temp files
ssh "$STOLUTION" 'rm -f /tmp/cf-r2-result.env /tmp/cf-r2-setup.sh /tmp/cf-diagnose.sh 2>/dev/null; echo cleaned'

unset CF_ACCOUNT R2_KEY_ID R2_SECRET R2_DOMAIN

log "R2 setup complete — run 'image-provider list' to verify"
