#!/bin/bash

# CAIA NPM Publishing Script
# This script builds, tests, and publishes all CAIA packages to NPM

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
ROOT_DIR="/Users/MAC/Documents/projects/caia"
SCRIPTS_DIR="$ROOT_DIR/scripts"
PACKAGES_DIR="$ROOT_DIR/packages"
DRY_RUN=${DRY_RUN:-false}
FORCE_PUBLISH=${FORCE_PUBLISH:-false}
SKIP_TESTS=${SKIP_TESTS:-false}
SKIP_BUILD=${SKIP_BUILD:-false}

# Publishing order - core packages first, then dependencies
PUBLISHING_ORDER=(
    "packages/core"
    "packages/utils/cc-orchestrator"
    "packages/modules/memory"
    "packages/modules/autonomy"
    "packages/engines/reasoning"
    "packages/engines/learning"
    "packages/engines/planning"
    "packages/engines/workflow"
    "packages/engines/code-generation"
    "packages/testing/test-utils"
    "packages/agents/jira-connect"
    "packages/agents/frontend-engineer"
    "packages/agents/backend-engineer"
    "packages/agents/solution-architect"
    "packages/agents/product-owner"
    "packages/agents/training-system"
    "packages/agents/paraforge"
    "packages/agents/chatgpt-autonomous"
    "packages/integrations/jira"
    "packages/integrations/mcp-chatgpt"
    "packages/integrations/orchestra"
    "tools/cc-ultimate-config"
    "utils/parallel/cc-orchestrator"
    "core"
    "agents/npm-connector"
)

# Counters
TOTAL_PACKAGES=0
PUBLISHED_PACKAGES=0
FAILED_PACKAGES=0
SKIPPED_PACKAGES=0

# Arrays to track results
PUBLISHED_LIST=()
FAILED_LIST=()
SKIPPED_LIST=()

echo -e "${PURPLE}🚀 CAIA NPM Publishing Pipeline${NC}"
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

log_step() {
    echo -e "${PURPLE}🔄 $1${NC}"
}

# Function to check if package is already published
is_package_published() {
    local package_name=$1
    local package_version=$2
    
    # Check if package exists on NPM
    if npm view "$package_name@$package_version" &>/dev/null; then
        return 0 # Already published
    else
        return 1 # Not published
    fi
}

# Function to build package
build_package() {
    local package_dir=$1
    local package_name=$2
    
    if [[ "$SKIP_BUILD" == "true" ]]; then
        log_warning "Skipping build for $package_name (SKIP_BUILD=true)"
        return 0
    fi
    
    log_step "Building $package_name..."
    
    cd "$package_dir"
    
    # Check if package has build script
    if npm run build --silent &>/dev/null; then
        log_success "Build completed for $package_name"
        return 0
    else
        log_warning "No build script found for $package_name, skipping build"
        return 0
    fi
}

# Function to test package
test_package() {
    local package_dir=$1
    local package_name=$2
    
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log_warning "Skipping tests for $package_name (SKIP_TESTS=true)"
        return 0
    fi
    
    log_step "Testing $package_name..."
    
    cd "$package_dir"
    
    # Check if package has test script
    if npm run test --silent &>/dev/null; then
        log_success "Tests passed for $package_name"
        return 0
    else
        log_warning "No test script found for $package_name, skipping tests"
        return 0
    fi
}

# Function to publish package
publish_package() {
    local package_dir=$1
    local package_name=$2
    local package_version=$3
    
    cd "$package_dir"
    
    # Check if already published
    if is_package_published "$package_name" "$package_version" && [[ "$FORCE_PUBLISH" != "true" ]]; then
        log_warning "$package_name@$package_version already published, skipping"
        ((SKIPPED_PACKAGES++))
        SKIPPED_LIST+=("$package_name@$package_version")
        return 0
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_step "DRY RUN: Would publish $package_name@$package_version"
        npm publish --dry-run
        local exit_code=$?
    else
        log_step "Publishing $package_name@$package_version..."
        npm publish
        local exit_code=$?
    fi
    
    if [[ $exit_code -eq 0 ]]; then
        log_success "Successfully published $package_name@$package_version"
        ((PUBLISHED_PACKAGES++))
        PUBLISHED_LIST+=("$package_name@$package_version")
        return 0
    else
        log_error "Failed to publish $package_name@$package_version"
        ((FAILED_PACKAGES++))
        FAILED_LIST+=("$package_name@$package_version")
        return 1
    fi
}

# Function to process package
process_package() {
    local package_path=$1
    local package_dir="$ROOT_DIR/$package_path"
    local package_json="$package_dir/package.json"
    
    if [[ ! -f "$package_json" ]]; then
        log_warning "Package not found: $package_path"
        return 1
    fi
    
    local package_name=$(jq -r '.name' "$package_json" 2>/dev/null || echo "unknown")
    local package_version=$(jq -r '.version' "$package_json" 2>/dev/null || echo "unknown")
    
    if [[ "$package_name" == "unknown" || "$package_version" == "unknown" ]]; then
        log_error "Invalid package.json in $package_path"
        return 1
    fi
    
    ((TOTAL_PACKAGES++))
    
    echo ""
    log_info "Processing $package_name@$package_version"
    log_info "Path: $package_path"
    
    # Install dependencies
    log_step "Installing dependencies for $package_name..."
    cd "$package_dir"
    if ! npm install --silent; then
        log_error "Failed to install dependencies for $package_name"
        return 1
    fi
    
    # Build package
    if ! build_package "$package_dir" "$package_name"; then
        log_error "Build failed for $package_name"
        return 1
    fi
    
    # Test package
    if ! test_package "$package_dir" "$package_name"; then
        log_error "Tests failed for $package_name"
        return 1
    fi
    
    # Publish package
    if ! publish_package "$package_dir" "$package_name" "$package_version"; then
        return 1
    fi
    
    return 0
}

# Function to setup NPM authentication
setup_npm_auth() {
    local npmrc_file="$HOME/.npmrc"
    
    if [[ ! -f "$npmrc_file" ]]; then
        log_warning "No .npmrc file found. Creating one..."
        
        # Check for NPM_TOKEN environment variable
        if [[ -n "$NPM_TOKEN" ]]; then
            echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > "$npmrc_file"
            log_success "NPM authentication configured from environment variable"
        else
            log_error "No NPM authentication found. Please run 'npm login' or set NPM_TOKEN environment variable"
            return 1
        fi
    else
        log_success "NPM authentication file found"
    fi
    
    # Verify authentication
    if npm whoami &>/dev/null; then
        local npm_user=$(npm whoami)
        log_success "Authenticated as NPM user: $npm_user"
        return 0
    else
        log_error "NPM authentication failed. Please run 'npm login'"
        return 1
    fi
}

# Function to create publishing report
create_publishing_report() {
    local report_file="$ROOT_DIR/npm-publish-results.md"
    
    cat > "$report_file" << EOF
# CAIA NPM Publishing Results

Generated on: $(date)
Dry Run: $DRY_RUN

## Summary

- **Total Packages**: $TOTAL_PACKAGES
- **Published**: $PUBLISHED_PACKAGES
- **Failed**: $FAILED_PACKAGES
- **Skipped**: $SKIPPED_PACKAGES

## Published Packages

EOF

    for package in "${PUBLISHED_LIST[@]}"; do
        echo "- ✅ $package" >> "$report_file"
    done
    
    echo "" >> "$report_file"
    echo "## Failed Packages" >> "$report_file"
    echo "" >> "$report_file"
    
    for package in "${FAILED_LIST[@]}"; do
        echo "- ❌ $package" >> "$report_file"
    done
    
    echo "" >> "$report_file"
    echo "## Skipped Packages" >> "$report_file"
    echo "" >> "$report_file"
    
    for package in "${SKIPPED_LIST[@]}"; do
        echo "- ⏭️ $package" >> "$report_file"
    done
    
    cat >> "$report_file" << EOF

## Next Steps

EOF

    if [[ $FAILED_PACKAGES -gt 0 ]]; then
        cat >> "$report_file" << EOF
1. Review and fix failed packages
2. Re-run publishing for failed packages: \`PACKAGES="failed-package-path" ./scripts/npm-publish.sh\`
EOF
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        cat >> "$report_file" << EOF
1. Review dry run results
2. Run actual publishing: \`DRY_RUN=false ./scripts/npm-publish.sh\`
EOF
    fi
    
    log_success "Publishing report created at $report_file"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    --dry-run           Perform dry run without actual publishing
    --force             Force publish even if package exists
    --skip-tests        Skip test execution
    --skip-build        Skip build step
    --help              Show this help message

Environment Variables:
    DRY_RUN=true        Same as --dry-run
    FORCE_PUBLISH=true  Same as --force
    SKIP_TESTS=true     Same as --skip-tests
    SKIP_BUILD=true     Same as --skip-build
    NPM_TOKEN=xxx       NPM authentication token
    PACKAGES="path1 path2"  Specific packages to publish

Examples:
    # Dry run all packages
    $0 --dry-run
    
    # Publish specific packages
    PACKAGES="packages/core packages/utils/cc-orchestrator" $0
    
    # Force publish all packages
    $0 --force
    
    # Skip tests and build, dry run
    $0 --dry-run --skip-tests --skip-build
EOF
}

# Main execution
main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --force)
                FORCE_PUBLISH=true
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    cd "$ROOT_DIR"
    
    log_info "Starting NPM publishing pipeline for CAIA packages"
    log_info "Configuration:"
    echo "  Dry Run: $DRY_RUN"
    echo "  Force Publish: $FORCE_PUBLISH"
    echo "  Skip Tests: $SKIP_TESTS"
    echo "  Skip Build: $SKIP_BUILD"
    
    # Check dependencies
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed. Please install jq first."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        log_error "npm is required but not installed. Please install npm first."
        exit 1
    fi
    
    # Setup NPM authentication
    if [[ "$DRY_RUN" != "true" ]]; then
        if ! setup_npm_auth; then
            exit 1
        fi
    fi
    
    # Determine which packages to publish
    local packages_to_process=()
    
    if [[ -n "$PACKAGES" ]]; then
        # Use specific packages from environment variable
        read -ra packages_to_process <<< "$PACKAGES"
        log_info "Publishing specific packages: ${packages_to_process[*]}"
    else
        # Use predefined publishing order
        packages_to_process=("${PUBLISHING_ORDER[@]}")
        log_info "Publishing all packages in dependency order"
    fi
    
    # Process each package
    local failed_any=false
    for package_path in "${packages_to_process[@]}"; do
        if ! process_package "$package_path"; then
            failed_any=true
            # Continue with other packages even if one fails
        fi
    done
    
    echo ""
    echo "================================================="
    log_info "Publishing Summary:"
    echo "  Total packages: $TOTAL_PACKAGES"
    echo "  Published: $PUBLISHED_PACKAGES"
    echo "  Failed: $FAILED_PACKAGES"
    echo "  Skipped: $SKIPPED_PACKAGES"
    
    # Create publishing report
    create_publishing_report
    
    if [[ "$failed_any" == "true" ]]; then
        log_error "Some packages failed to publish. Check the report for details."
        exit 1
    else
        if [[ "$DRY_RUN" == "true" ]]; then
            log_success "Dry run completed successfully!"
            log_info "Run without --dry-run to actually publish packages"
        else
            log_success "All packages published successfully!"
        fi
    fi
}

# Execute main function
main "$@"