#!/usr/bin/env bash
# new-site.sh — scaffold a new PokerZeno site from site-template
# Usage: bash bin/new-site.sh <slug> [--dry-run]
#   slug: short identifier, e.g. blackjack-hub
#   Prompted interactively: SITE_NAME, DOMAIN
# Env vars (optional, skip prompts):
#   SITE_NAME="BlackjackHub"
#   DOMAIN="blackjackhub.com"
#   TEMPLATE_DIR="/path/to/site-template"  (default: ../site-template)
#   OUTPUT_DIR="/path/to/output"            (default: ../<slug>)

set -euo pipefail

SLUG="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

# Validate slug
if [[ -z "$SLUG" ]]; then
  echo "Usage: bash bin/new-site.sh <slug> [--dry-run]"
  echo "  Example: bash bin/new-site.sh blackjack-hub"
  exit 1
fi

if [[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "Error: slug must be lowercase alphanumeric with hyphens only. Got: $SLUG"
  exit 1
fi

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_DIR="${TEMPLATE_DIR:-$(dirname "$FRAMEWORK_DIR")/site-template}"
OUTPUT_DIR="${OUTPUT_DIR:-$(dirname "$FRAMEWORK_DIR")/$SLUG}"

# Prompt for missing vars
if [[ -z "${SITE_NAME:-}" ]]; then
  read -rp "Site name (e.g. BlackjackHub): " SITE_NAME
fi
if [[ -z "${DOMAIN:-}" ]]; then
  read -rp "Domain (e.g. blackjackhub.com): " DOMAIN
fi

echo ""
echo "=== new-site.sh ==="
echo "  Slug:        $SLUG"
echo "  Site name:   $SITE_NAME"
echo "  Domain:      $DOMAIN"
echo "  Template:    $TEMPLATE_DIR"
echo "  Output:      $OUTPUT_DIR"
echo "  Dry run:     $DRY_RUN"
echo ""

# Validate template exists
if [[ ! -d "$TEMPLATE_DIR" ]]; then
  echo "Error: site-template not found at $TEMPLATE_DIR"
  echo "Set TEMPLATE_DIR env var or ensure site-template/ exists alongside framework/"
  exit 1
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[dry-run] Would create: $OUTPUT_DIR"
  echo "[dry-run] Would copy from: $TEMPLATE_DIR"
  echo "[dry-run] Would replace placeholders:"
  echo "  {{SITE_NAME}}  -> $SITE_NAME"
  echo "  {{DOMAIN}}     -> $DOMAIN"
  echo "  {{SLUG}}       -> $SLUG"
  echo "[dry-run] Would run: npm install in $OUTPUT_DIR"
  echo "[dry-run] Would run: git init && git commit in $OUTPUT_DIR"
  echo ""
  echo "Files that would be created (from template):"
  find "$TEMPLATE_DIR" -type f \
    ! -path "*/.git/*" \
    ! -path "*/node_modules/*" \
    ! -path "*/.next/*" \
    | sed "s|$TEMPLATE_DIR/||" | sort
  echo ""
  echo "[dry-run] Done. No files created."
  exit 0
fi

# Check output dir doesn't already exist
if [[ -d "$OUTPUT_DIR" ]]; then
  echo "Error: $OUTPUT_DIR already exists. Remove it first."
  exit 1
fi

# Copy template
echo "Copying template..."
cp -r "$TEMPLATE_DIR" "$OUTPUT_DIR"

# Remove template git history
rm -rf "$OUTPUT_DIR/.git"

# Replace placeholders in all text files
echo "Replacing placeholders..."
find "$OUTPUT_DIR" -type f \
  ! -path "*/node_modules/*" \
  ! -path "*/.next/*" \
  ! -name "*.png" ! -name "*.jpg" ! -name "*.ico" ! -name "*.woff*" \
  | while read -r file; do
    if file "$file" | grep -q text; then
      sed -i '' \
        "s|{{SITE_NAME}}|$SITE_NAME|g; \
         s|{{DOMAIN}}|$DOMAIN|g; \
         s|{{SLUG}}|$SLUG|g" \
        "$file"
    fi
  done

# npm install
if command -v npm &>/dev/null; then
  echo "Installing dependencies..."
  (cd "$OUTPUT_DIR" && npm install --silent)
else
  echo "Warning: npm not found. Run npm install manually in $OUTPUT_DIR"
fi

# Git init
echo "Initializing git..."
(cd "$OUTPUT_DIR" && git init && git add -A && git commit -m "feat: scaffold $SITE_NAME from site-template")

echo ""
echo "Done! Site created at: $OUTPUT_DIR"
echo "Next steps:"
echo "  1. cd $OUTPUT_DIR"
echo "  2. npm run dev"
echo "  3. Configure DNS for $DOMAIN"
