#!/usr/bin/env bash
set -euo pipefail

echo "=== CAIA Git Auth Bootstrap ==="
echo "Fetching GitHub token from HashiCorp Vault on stolution..."

# Step 1: Find the vault container on stolution
VAULT_CONTAINER=$(ssh stolution "docker ps --filter 'ancestor=vault' --filter 'ancestor=hashicorp/vault' --format '{{.Names}}' 2>/dev/null | head -1 || docker ps --format '{{.Names}}' 2>/dev/null | grep -i vault | head -1")

if [ -z "$VAULT_CONTAINER" ]; then
  echo "ERROR: Could not find vault container on stolution"
  echo "Available containers:"
  ssh stolution "docker ps --format '{{.Names}}'"
  exit 1
fi
echo "Found vault container: $VAULT_CONTAINER"

# Step 2: Get vault address and token
VAULT_ADDR=$(ssh stolution "docker exec $VAULT_CONTAINER env | grep VAULT_ADDR | cut -d= -f2 || echo 'http://127.0.0.1:8200'")
VAULT_TOKEN=$(ssh stolution "docker exec $VAULT_CONTAINER env | grep 'VAULT_TOKEN\|VAULT_DEV_ROOT_TOKEN_ID' | cut -d= -f2 | head -1")

if [ -z "$VAULT_TOKEN" ]; then
  # Try reading from common vault token file locations
  VAULT_TOKEN=$(ssh stolution "cat ~/.vault-token 2>/dev/null || cat /root/.vault-token 2>/dev/null || echo ''")
fi

echo "Vault address: $VAULT_ADDR"

# Step 3: Try to read GitHub token from vault (try multiple common paths)
GITHUB_TOKEN=""

for SECRET_PATH in "secret/github" "kv/github" "secret/data/github" "kv/data/github" "secret/api-keys" "kv/api-keys" "secret/credentials" "kv/credentials"; do
  TOKEN=$(ssh stolution "docker exec -e VAULT_ADDR=$VAULT_ADDR -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CONTAINER vault kv get -field=token $SECRET_PATH 2>/dev/null || vault kv get -field=github_token $SECRET_PATH 2>/dev/null || vault kv get -field=value $SECRET_PATH 2>/dev/null || echo ''" 2>/dev/null || true)
  if [ -n "$TOKEN" ] && [[ "$TOKEN" == ghp_* ]] || [[ "$TOKEN" == github_pat_* ]] || [[ "$TOKEN" == ghs_* ]]; then
    GITHUB_TOKEN="$TOKEN"
    echo "Found GitHub token at vault path: $SECRET_PATH"
    break
  fi
done

if [ -z "$GITHUB_TOKEN" ]; then
  echo ""
  echo "Could not auto-discover GitHub token. Listing available vault secrets:"
  ssh stolution "docker exec -e VAULT_ADDR=$VAULT_ADDR -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CONTAINER vault kv list secret/ 2>/dev/null || vault secrets list 2>/dev/null"
  echo ""
  echo "Please provide the vault secret path manually:"
  read -p "Secret path (e.g. secret/github): " SECRET_PATH
  GITHUB_TOKEN=$(ssh stolution "docker exec -e VAULT_ADDR=$VAULT_ADDR -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CONTAINER vault kv get $SECRET_PATH" | grep -E "token|value|github" | awk '{print $2}' | head -1)
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: Failed to retrieve GitHub token from vault"
  exit 1
fi

echo "GitHub token retrieved: ${GITHUB_TOKEN:0:10}..."

# Step 4: Configure git remote with token
REPO_DIR="$HOME/Documents/projects/conductor"
git -C "$REPO_DIR" remote set-url origin "https://${GITHUB_TOKEN}@github.com/prakashgbid/conductor.git"
echo "✅ Git remote configured with token"

# Step 5: Also configure gh CLI if installed
if command -v gh &>/dev/null; then
  echo "$GITHUB_TOKEN" | gh auth login --with-token
  echo "✅ gh CLI authenticated"
else
  echo "ℹ️  gh CLI not installed. Install with: brew install gh"
  echo "   Then run: echo '$GITHUB_TOKEN' | gh auth login --with-token"
fi

# Step 6: Store token in shell environment for future use
SHELL_RC="$HOME/.zshenv"
if ! grep -q "GITHUB_TOKEN" "$SHELL_RC" 2>/dev/null; then
  echo "export GITHUB_TOKEN=${GITHUB_TOKEN}" >> "$SHELL_RC"
  echo "✅ GITHUB_TOKEN added to $SHELL_RC"
fi

# Step 7: Test push
echo ""
echo "Testing push..."
git -C "$REPO_DIR" push --set-upstream origin "$(git -C "$REPO_DIR" branch --show-current)" && echo "✅ Push successful!" || echo "❌ Push failed — check SSH key registration with GitHub"

echo ""
echo "=== Done ==="
echo "Git remote: $(git -C $REPO_DIR remote get-url origin)"
