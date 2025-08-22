#!/bin/bash

# Simple package verification script (no jq dependency)
# This script checks basic package structure without jq

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ROOT_DIR="/Users/MAC/Documents/projects/caia"

echo -e "${BLUE}🔍 CAIA Package Verification (Basic)${NC}"
echo "================================================="

# Function to log messages
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Find all package.json files
log_info "Searching for packages..."

find_packages() {
    find "$ROOT_DIR" -name "package.json" -not -path "*/node_modules/*" -not -path "$ROOT_DIR/package.json" | sort
}

# Count packages
package_files=($(find_packages))
total_packages=${#package_files[@]}

log_info "Found $total_packages packages to verify"

# Basic verification for each package
valid_packages=0
invalid_packages=0

for package_file in "${package_files[@]}"; do
    package_dir=$(dirname "$package_file")
    relative_path=$(echo "$package_dir" | sed "s|$ROOT_DIR/||")
    
    echo ""
    log_info "Checking: $relative_path"
    
    # Check if package.json is valid JSON (basic check)
    if grep -q '"name"' "$package_file" && grep -q '"version"' "$package_file"; then
        # Extract package name (simple grep approach)
        package_name=$(grep '"name"' "$package_file" | head -1 | sed 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/')
        package_version=$(grep '"version"' "$package_file" | head -1 | sed 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/')
        
        log_success "Package: $package_name@$package_version"
        
        # Check for @caia scope
        if [[ "$package_name" =~ ^@caia/ ]]; then
            log_success "✓ Uses @caia scope"
        else
            log_warning "✗ Missing @caia scope"
        fi
        
        # Check for README
        if [[ -f "$package_dir/README.md" ]]; then
            log_success "✓ Has README.md"
        else
            log_warning "✗ Missing README.md"
        fi
        
        # Check for TypeScript config
        if [[ -f "$package_dir/tsconfig.json" ]] || [[ -f "$ROOT_DIR/tsconfig.json" ]]; then
            log_success "✓ TypeScript configured"
        else
            log_warning "✗ No TypeScript config"
        fi
        
        # Check for source directory
        if [[ -d "$package_dir/src" ]]; then
            log_success "✓ Has src directory"
        else
            log_warning "✗ No src directory"
        fi
        
        # Check for build script
        if grep -q '"build"' "$package_file"; then
            log_success "✓ Has build script"
        else
            log_warning "✗ No build script"
        fi
        
        # Check for test script
        if grep -q '"test"' "$package_file"; then
            log_success "✓ Has test script"
        else
            log_warning "✗ No test script"
        fi
        
        # Check for publishConfig
        if grep -q '"publishConfig"' "$package_file"; then
            log_success "✓ Has publishConfig"
        else
            log_warning "✗ Missing publishConfig"
        fi
        
        ((valid_packages++))
    else
        log_error "Invalid package.json format"
        ((invalid_packages++))
    fi
done

echo ""
echo "================================================="
log_info "Verification Summary:"
echo "  Total packages: $total_packages"
echo "  Valid packages: $valid_packages"
echo "  Invalid packages: $invalid_packages"

if [[ $invalid_packages -eq 0 ]]; then
    log_success "All packages have valid structure!"
    echo ""
    log_info "Next steps:"
    echo "  1. Install jq for full validation: brew install jq"
    echo "  2. Run full preparation: ./scripts/prepare-npm-publish.sh"
    echo "  3. Test publishing: npm run publish:dry-run"
    echo "  4. Actual publishing: npm run publish:all"
else
    log_error "Some packages need attention before publishing"
fi

echo ""
log_info "Available NPM scripts:"
echo "  npm run publish:prepare    - Full package preparation"
echo "  npm run publish:dry-run    - Test publishing without actual upload"
echo "  npm run publish:all        - Publish all packages"
echo "  npm run publish:core       - Publish core package only"
echo "  npm run publish:agents     - Publish agent packages"
echo "  npm run publish:engines    - Publish engine packages"
echo "  npm run publish:utils      - Publish utility packages"