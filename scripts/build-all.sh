#!/bin/bash

# CAIA Master Build Script
# Builds all packages in dependency order, runs tests, and generates reports
# Author: CAIA DevOps Team
# Version: 1.0.0

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_LOG="$PROJECT_ROOT/build.log"
COVERAGE_THRESHOLD=80
PARALLEL_JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# Command line options
CLEAN_BUILD=false
SKIP_TESTS=false
SKIP_LINT=false
VERBOSE=false
WATCH_MODE=false
BUILD_DOCS=false
PROFILE=false

# Performance tracking
START_TIME=$(date +%s)
BUILD_STATS="$PROJECT_ROOT/build-stats.json"

# Logging functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$BUILD_LOG"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$BUILD_LOG"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$BUILD_LOG"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$BUILD_LOG"
}

# Usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Build all CAIA packages in dependency order.

OPTIONS:
    -c, --clean         Clean build (remove all dist/node_modules)
    -t, --skip-tests    Skip test execution
    -l, --skip-lint     Skip linting
    -v, --verbose       Verbose output
    -w, --watch         Watch mode for development
    -d, --docs          Build documentation
    -p, --profile       Enable build profiling
    -h, --help          Show this help message

EXAMPLES:
    $0                  # Standard build
    $0 -c -v            # Clean build with verbose output
    $0 --skip-tests     # Build without running tests
    $0 -w               # Watch mode for development

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -c|--clean)
                CLEAN_BUILD=true
                shift
                ;;
            -t|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -l|--skip-lint)
                SKIP_LINT=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -w|--watch)
                WATCH_MODE=true
                shift
                ;;
            -d|--docs)
                BUILD_DOCS=true
                shift
                ;;
            -p|--profile)
                PROFILE=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# Initialize build environment
init_build() {
    log "Initializing CAIA build environment..."
    
    # Change to project root
    cd "$PROJECT_ROOT"
    
    # Create build log
    > "$BUILD_LOG"
    
    # Check prerequisites
    check_prerequisites
    
    # Set environment variables
    export NODE_ENV=production
    export CI=true
    
    if [[ "$VERBOSE" == "true" ]]; then
        export DEBUG="caia:*"
    fi
    
    log "Build environment initialized"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check Node.js version
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    local node_version=$(node --version | cut -d'v' -f2)
    local required_version="18.0.0"
    
    if ! npx semver --range ">=$required_version" "$node_version" &> /dev/null; then
        log_error "Node.js version $node_version is below required $required_version"
        exit 1
    fi
    
    # Check package manager
    if ! command -v pnpm &> /dev/null; then
        log_warning "pnpm not found, installing..."
        npm install -g pnpm
    fi
    
    # Check lerna
    if ! command -v lerna &> /dev/null; then
        log_warning "lerna not found, installing..."
        npm install -g lerna
    fi
    
    log_success "Prerequisites check passed"
}

# Clean build artifacts
clean_build() {
    if [[ "$CLEAN_BUILD" == "true" ]]; then
        log "Performing clean build..."
        
        # Remove node_modules
        find . -name "node_modules" -type d -prune -exec rm -rf {} +
        
        # Remove build artifacts
        find . -name "dist" -type d -prune -exec rm -rf {} +
        find . -name "lib" -type d -prune -exec rm -rf {} +
        find . -name "build" -type d -prune -exec rm -rf {} +
        find . -name "coverage" -type d -prune -exec rm -rf {} +
        
        # Remove lock files
        find . -name "package-lock.json" -delete
        find . -name "yarn.lock" -delete
        
        log_success "Clean build completed"
    fi
}

# Install dependencies
install_dependencies() {
    log "Installing dependencies..."
    
    local start_time=$(date +%s)
    
    if [[ "$VERBOSE" == "true" ]]; then
        pnpm install --frozen-lockfile
    else
        pnpm install --frozen-lockfile > /dev/null 2>&1
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Dependencies installed in ${duration}s"
    
    # Bootstrap lerna
    log "Bootstrapping lerna..."
    lerna bootstrap > /dev/null 2>&1
    log_success "Lerna bootstrap completed"
}

# Get package dependency order
get_build_order() {
    log "Calculating package build order..."
    
    # Use lerna to get topological order
    lerna list --toposort --json > /tmp/build-order.json
    
    if [[ ! -s /tmp/build-order.json ]]; then
        log_error "Failed to determine build order"
        exit 1
    fi
    
    log_success "Build order calculated"
}

# Lint code
lint_code() {
    if [[ "$SKIP_LINT" == "false" ]]; then
        log "Running code linting..."
        
        local start_time=$(date +%s)
        
        if [[ "$VERBOSE" == "true" ]]; then
            pnpm run lint
        else
            pnpm run lint > /dev/null 2>&1
        fi
        
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        log_success "Code linting completed in ${duration}s"
    else
        log_warning "Skipping code linting"
    fi
}

# Type checking
type_check() {
    log "Running TypeScript type checking..."
    
    local start_time=$(date +%s)
    
    if [[ "$VERBOSE" == "true" ]]; then
        pnpm run type-check
    else
        pnpm run type-check > /dev/null 2>&1
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Type checking completed in ${duration}s"
}

# Build packages
build_packages() {
    log "Building packages in dependency order..."
    
    local start_time=$(date +%s)
    local packages=$(cat /tmp/build-order.json | jq -r '.[].name')
    local total_packages=$(echo "$packages" | wc -l)
    local current=0
    
    for package in $packages; do
        current=$((current + 1))
        log "Building package $current/$total_packages: $package"
        
        local package_start=$(date +%s)
        
        # Build individual package
        if [[ "$VERBOSE" == "true" ]]; then
            lerna run build --scope="$package" --stream
        else
            lerna run build --scope="$package" > /dev/null 2>&1
        fi
        
        local package_end=$(date +%s)
        local package_duration=$((package_end - package_start))
        
        log_success "Package $package built in ${package_duration}s"
    done
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    log_success "All packages built in ${total_duration}s"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "false" ]]; then
        log "Running test suites..."
        
        local start_time=$(date +%s)
        
        # Unit tests
        log "Running unit tests..."
        if [[ "$VERBOSE" == "true" ]]; then
            pnpm run test:unit --coverage
        else
            pnpm run test:unit --coverage > /dev/null 2>&1
        fi
        
        # Integration tests
        log "Running integration tests..."
        if [[ "$VERBOSE" == "true" ]]; then
            pnpm run test:integration
        else
            pnpm run test:integration > /dev/null 2>&1
        fi
        
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        log_success "All tests completed in ${duration}s"
        
        # Check coverage
        check_coverage
    else
        log_warning "Skipping tests"
    fi
}

# Check test coverage
check_coverage() {
    log "Checking test coverage..."
    
    if [[ -f "coverage/lcov-report/index.html" ]]; then
        # Extract coverage percentage from lcov report
        local coverage=$(grep -o 'headerCovTableEntryLo">[0-9.]*%' coverage/lcov-report/index.html | head -1 | grep -o '[0-9.]*' || echo "0")
        
        if (( $(echo "$coverage >= $COVERAGE_THRESHOLD" | bc -l) )); then
            log_success "Coverage: ${coverage}% (threshold: ${COVERAGE_THRESHOLD}%)"
        else
            log_warning "Coverage: ${coverage}% below threshold: ${COVERAGE_THRESHOLD}%"
        fi
    else
        log_warning "Coverage report not found"
    fi
}

# Validate builds
validate_builds() {
    log "Validating build outputs..."
    
    local validation_errors=0
    
    # Check TypeScript compilation
    if ! pnpm run type-check > /dev/null 2>&1; then
        log_error "TypeScript compilation failed"
        validation_errors=$((validation_errors + 1))
    fi
    
    # Check package exports
    local packages=$(cat /tmp/build-order.json | jq -r '.[].location')
    for package_dir in $packages; do
        if [[ -f "$package_dir/package.json" ]]; then
            local main_field=$(cat "$package_dir/package.json" | jq -r '.main // empty')
            local types_field=$(cat "$package_dir/package.json" | jq -r '.types // empty')
            
            if [[ -n "$main_field" && ! -f "$package_dir/$main_field" ]]; then
                log_error "Missing main export: $package_dir/$main_field"
                validation_errors=$((validation_errors + 1))
            fi
            
            if [[ -n "$types_field" && ! -f "$package_dir/$types_field" ]]; then
                log_error "Missing types export: $package_dir/$types_field"
                validation_errors=$((validation_errors + 1))
            fi
        fi
    done
    
    if [[ $validation_errors -eq 0 ]]; then
        log_success "Build validation passed"
    else
        log_error "Build validation failed with $validation_errors errors"
        exit 1
    fi
}

# Build documentation
build_documentation() {
    if [[ "$BUILD_DOCS" == "true" ]]; then
        log "Building documentation..."
        
        local start_time=$(date +%s)
        
        if [[ "$VERBOSE" == "true" ]]; then
            pnpm run docs:build
        else
            pnpm run docs:build > /dev/null 2>&1
        fi
        
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        log_success "Documentation built in ${duration}s"
    fi
}

# Generate build report
generate_report() {
    log "Generating build report..."
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - START_TIME))
    
    # Create build stats
    cat > "$BUILD_STATS" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "duration": $total_duration,
  "success": true,
  "packages": $(cat /tmp/build-order.json | jq '[.[] | {name: .name, location: .location}]'),
  "options": {
    "clean": $CLEAN_BUILD,
    "skipTests": $SKIP_TESTS,
    "skipLint": $SKIP_LINT,
    "verbose": $VERBOSE,
    "buildDocs": $BUILD_DOCS
  },
  "environment": {
    "nodeVersion": "$(node --version)",
    "pnpmVersion": "$(pnpm --version)",
    "platform": "$(uname -s)",
    "arch": "$(uname -m)"
  }
}
EOF
    
    # Print summary
    echo ""
    echo "========================================"
    echo "🚀 CAIA Build Summary"
    echo "========================================"
    echo "Total duration: ${total_duration}s"
    echo "Packages built: $(cat /tmp/build-order.json | jq length)"
    echo "Build log: $BUILD_LOG"
    echo "Build stats: $BUILD_STATS"
    
    if [[ -f "coverage/lcov-report/index.html" ]]; then
        echo "Coverage report: coverage/lcov-report/index.html"
    fi
    
    echo "========================================"
    
    log_success "Build completed successfully in ${total_duration}s"
}

# Error handling
handle_error() {
    local exit_code=$?
    log_error "Build failed with exit code $exit_code"
    
    # Update build stats with failure
    if [[ -f "$BUILD_STATS" ]]; then
        cat "$BUILD_STATS" | jq '.success = false | .exitCode = '$exit_code > "$BUILD_STATS.tmp"
        mv "$BUILD_STATS.tmp" "$BUILD_STATS"
    fi
    
    echo ""
    echo "========================================"
    echo "💥 Build Failed"
    echo "========================================"
    echo "Check build log: $BUILD_LOG"
    echo "Exit code: $exit_code"
    echo "========================================"
    
    exit $exit_code
}

# Watch mode
watch_mode() {
    if [[ "$WATCH_MODE" == "true" ]]; then
        log "Starting watch mode..."
        
        # Use nodemon or similar tool for watching
        if command -v nodemon &> /dev/null; then
            nodemon --watch "packages/*/src" --ext "ts,js" --exec "$0"
        else
            log_warning "Watch mode requires nodemon. Install with: npm install -g nodemon"
            exit 1
        fi
    fi
}

# Profile build performance
profile_build() {
    if [[ "$PROFILE" == "true" ]]; then
        log "Profiling enabled - detailed performance tracking"
        # Additional profiling logic can be added here
    fi
}

# Main execution
main() {
    # Set up error handling
    trap handle_error ERR
    
    # Parse arguments
    parse_args "$@"
    
    # Initialize
    init_build
    
    # Check for watch mode
    watch_mode
    
    # Enable profiling if requested
    profile_build
    
    # Build steps
    clean_build
    install_dependencies
    get_build_order
    lint_code
    type_check
    build_packages
    run_tests
    validate_builds
    build_documentation
    generate_report
}

# Execute main function
main "$@"