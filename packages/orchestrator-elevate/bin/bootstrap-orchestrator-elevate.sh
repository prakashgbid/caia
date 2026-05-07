#!/usr/bin/env bash
# bootstrap-orchestrator-elevate.sh
# One-time bootstrap installer for orchestrator-elevate on stolution.
# Run as: bash bootstrap-orchestrator-elevate.sh (will prompt for sudo password)
# Prerequisites: orchestrator-exec, orchestrator.sudoers, orchestrator-policy.hcl staged in /tmp/

set -euo pipefail

echo "=== Orchestrator-Elevate Bootstrap Installer ==="
echo ""
echo "This script will install:"
echo "  1. /usr/local/bin/orchestrator-exec (wrapper script)"
echo "  2. /etc/sudoers.d/orchestrator (sudoers entry)"
echo "  3. Vault AppRole 'orchestrator' with scoped policy"
echo "  4. Vault credentials at /home/s903/.orchestrator-vault-creds"
echo ""
read -p "Proceed? (y/N): " -r
if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "--- Step 1: Install /usr/local/bin/orchestrator-exec ---"

if [ ! -f "/tmp/orchestrator-exec" ]; then
  echo "ERROR: /tmp/orchestrator-exec not found. Ensure it is staged before running this script."
  exit 1
fi

sudo install -m 0755 -o root -g root /tmp/orchestrator-exec /usr/local/bin/orchestrator-exec
echo "✓ Installed orchestrator-exec wrapper"

echo ""
echo "--- Step 2: Install /etc/sudoers.d/orchestrator ---"

if [ ! -f "/tmp/orchestrator.sudoers" ]; then
  echo "ERROR: /tmp/orchestrator.sudoers not found. Ensure it is staged before running this script."
  exit 1
fi

# Validate sudoers syntax first
if ! sudo visudo -c -f /tmp/orchestrator.sudoers >/dev/null 2>&1; then
  echo "ERROR: sudoers file failed syntax validation"
  exit 1
fi
echo "✓ Sudoers syntax validated"

sudo install -m 0440 -o root -g root /tmp/orchestrator.sudoers /etc/sudoers.d/orchestrator
echo "✓ Installed sudoers entry at /etc/sudoers.d/orchestrator"

echo ""
echo "--- Step 3: Configure Vault AppRole ---"

if [ ! -f "/tmp/orchestrator-policy.hcl" ]; then
  echo "ERROR: /tmp/orchestrator-policy.hcl not found. Ensure it is staged before running this script."
  exit 1
fi

# Check if VAULT_ADDR is set
if [ -z "${VAULT_ADDR:-}" ]; then
  echo "ERROR: VAULT_ADDR environment variable not set. Please set it and try again."
  echo "  Example: export VAULT_ADDR=http://localhost:8200"
  exit 1
fi

# Prompt for root token (one-time use)
echo ""
echo "To configure the Vault AppRole, we need a temporary root token or admin token."
echo "This token is used ONLY for this bootstrap and will NOT be stored anywhere."
echo ""
read -sp "Enter Vault root token (will not echo): " VAULT_TOKEN
echo ""
export VAULT_TOKEN

# Verify token is valid
if ! vault token lookup >/dev/null 2>&1; then
  echo "ERROR: Invalid Vault token. Aborting."
  unset VAULT_TOKEN
  exit 1
fi
echo "✓ Vault token validated"

# Write policy
if vault policy write orchestrator /tmp/orchestrator-policy.hcl >/dev/null 2>&1; then
  echo "✓ Vault policy 'orchestrator' created/updated"
else
  echo "ERROR: Failed to write Vault policy"
  unset VAULT_TOKEN
  exit 1
fi

# Create/update AppRole
if vault write auth/approle/role/orchestrator \
  token_ttl=24h \
  token_max_ttl=720h \
  token_policies=orchestrator \
  secret_id_ttl=365d \
  secret_id_num_uses=0 \
  >/dev/null 2>&1; then
  echo "✓ Vault AppRole 'orchestrator' configured"
else
  echo "ERROR: Failed to configure AppRole"
  unset VAULT_TOKEN
  exit 1
fi

# Generate role_id and secret_id
echo ""
echo "Generating AppRole credentials..."

role_id=$(vault read -field=role_id auth/approle/role/orchestrator/role-id 2>/dev/null)
if [ -z "$role_id" ]; then
  echo "ERROR: Failed to read role_id"
  unset VAULT_TOKEN
  exit 1
fi

secret_id=$(vault write -field=secret_id -f auth/approle/role/orchestrator/secret-id 2>/dev/null)
if [ -z "$secret_id" ]; then
  echo "ERROR: Failed to generate secret_id"
  unset VAULT_TOKEN
  exit 1
fi

echo "✓ AppRole credentials generated"

# Write credentials to /home/s903/.orchestrator-vault-creds
echo ""
echo "--- Step 4: Write Vault Credentials ---"

creds_file="/home/s903/.orchestrator-vault-creds"

if [ -e "$creds_file" ]; then
  echo "WARNING: $creds_file already exists. Backing up to ${creds_file}.backup"
  sudo cp "$creds_file" "${creds_file}.backup"
fi

{
  echo "$role_id"
  echo "$secret_id"
} | sudo tee "$creds_file" >/dev/null 2>&1

sudo chmod 0600 "$creds_file"
sudo chown s903:s903 "$creds_file"
echo "✓ Vault credentials written to $creds_file (mode 0600)"

# Clean up token
unset VAULT_TOKEN

echo ""
echo "=== Bootstrap Complete ==="
echo ""
echo "Next steps:"
echo "  1. Unset your VAULT_TOKEN: unset VAULT_TOKEN"
echo "  2. The orchestrator-exec wrapper is now available via: sudo /usr/local/bin/orchestrator-exec <operation> [args]"
echo "  3. The s903 user can now invoke the wrapper without a password prompt."
echo "  4. Cowork orchestrator can authenticate to Vault using AppRole at $creds_file"
echo ""
echo "To revoke this installation:"
echo "  sudo rm /usr/local/bin/orchestrator-exec /etc/sudoers.d/orchestrator"
echo "  vault policy delete orchestrator"
echo "  vault delete auth/approle/role/orchestrator"
echo ""
