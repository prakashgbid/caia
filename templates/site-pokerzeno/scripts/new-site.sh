#!/bin/bash
set -euo pipefail

SITE_DIR="${1:-}"
SITE_NAME="${2:-MySite}"

if [ -z "$SITE_DIR" ]; then
  echo "Usage: ./scripts/new-site.sh <target-dir> [site-name]"
  exit 1
fi

echo "Scaffolding new site: $SITE_NAME -> $SITE_DIR"

# Copy template
cp -r "$(dirname "$0")/.." "$SITE_DIR"

# Remove template-specific files
rm -rf "$SITE_DIR/.git" "$SITE_DIR/node_modules" "$SITE_DIR/.next" "$SITE_DIR/out"

# Replace placeholder tokens
find "$SITE_DIR/src" -name "*.tsx" -o -name "*.ts" | xargs sed -i.bak "s/SITE_NAME/$SITE_NAME/g"
find "$SITE_DIR/src" -name "*.bak" -delete

echo ""
echo "✅ Site scaffolded at $SITE_DIR"
echo "Next steps:"
echo "  1. cd $SITE_DIR"
echo "  2. Edit SITE_BRAND_LOCK.md with your brand"
echo "  3. Edit .env.example -> .env.local"
echo "  4. npm install"
echo "  5. npm run dev"
