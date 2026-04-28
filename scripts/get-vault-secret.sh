#!/usr/bin/env bash
# Usage: ./get-vault-secret.sh secret/github token
SECRET_PATH="${1:-secret/github}"
FIELD="${2:-token}"

VAULT_CONTAINER=$(ssh stolution "docker ps --format '{{.Names}}' | grep -i vault | head -1")
VAULT_TOKEN=$(ssh stolution "cat ~/.vault-token 2>/dev/null || docker exec $VAULT_CONTAINER env | grep VAULT_TOKEN | cut -d= -f2")

ssh stolution "docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CONTAINER vault kv get -field=$FIELD $SECRET_PATH 2>/dev/null"
