#!/usr/bin/env bash
set -euo pipefail

echo "=== @pokerzeno/backend-core: Supabase Init ==="

# Check for access token in vault path or env
TOKEN_FILE="$HOME/.stolution-vault/supabase-token"
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}"

if [ -z "$SUPABASE_ACCESS_TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
  SUPABASE_ACCESS_TOKEN=$(cat "$TOKEN_FILE")
fi

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo ""
  echo "No Supabase access token found."
  echo ""
  echo "To create your Supabase project:"
  echo "  1. Go to https://supabase.com -> sign in -> New Project"
  echo "  2. Choose a name (e.g. 'pokerzeno-backend') and a strong DB password"
  echo "  3. Select the Free tier"
  echo "  4. Once created, copy your Project URL and anon key from Settings -> API"
  echo "  5. Paste into .env:"
  echo "       SUPABASE_URL=https://xxx.supabase.co"
  echo "       SUPABASE_ANON_KEY=eyJ..."
  echo "       SUPABASE_SERVICE_ROLE_KEY=eyJ..."
  echo "  6. Run migrations: supabase db push --db-url \$DATABASE_URL"
  echo ""
  echo "Or for local dev: supabase start (requires Docker)"
  exit 0
fi

echo "Access token found. Creating project via Supabase Management API..."

# This requires supabase CLI >= 1.140
supabase projects create pokerzeno-backend \
  --org-id "${SUPABASE_ORG_ID:?Set SUPABASE_ORG_ID}" \
  --db-password "${SUPABASE_DB_PASSWORD:?Set SUPABASE_DB_PASSWORD}" \
  --region us-east-1 \
  --plan free

echo "Project created. Now run migrations:"
echo "  supabase db push"
