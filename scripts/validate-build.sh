#!/bin/bash

# CAIA Build Validation Script
# Validates build outputs and package integrity
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
VALIDATION_LOG="$PROJECT_ROOT/validation.log"

# Validation results
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0

# Logging functions
log() {
    echo -e "${BLUE}[VALIDATE]${NC} $1" | tee -a "$VALIDATION_LOG"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$VALIDATION_LOG"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$VALIDATION_LOG"
    VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$VALIDATION_LOG"
    VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
}

# Initialize validation
init_validation() {
    log "Starting CAIA build validation..."
    
    # Change to project root
    cd "$PROJECT_ROOT"
    
    # Create validation log
    > "$VALIDATION_LOG"
    
    # Reset counters
    VALIDATION_ERRORS=0
    VALIDATION_WARNINGS=0
}

# Validate package structure
validate_package_structure() {
    log "Validating package structure..."
    
    # Get all packages
    local packages=$(find packages -name "package.json" -not -path "*/node_modules/*" | sort)
    
    for package_json in $packages; do
        local package_dir=$(dirname "$package_json")
        local package_name=$(cat "$package_json" | jq -r '.name // empty')
        
        if [[ -z "$package_name" ]]; then
            log_error "Package name missing in $package_json"
            continue
        fi
        
        log "Validating package: $package_name"
        
        # Check required fields
        validate_package_json "$package_json"
        
        # Check build outputs
        validate_build_outputs "$package_dir" "$package_json"
        
        # Check TypeScript definitions
        validate_typescript_definitions "$package_dir" "$package_json"
        
        # Check exports
        validate_package_exports "$package_dir" "$package_json"
    done
}

# Validate package.json structure
validate_package_json() {
    local package_json="$1"
    local package_dir=$(dirname "$package_json")
    
    # Required fields
    local required_fields=("name" "version" "description" "main" "types" "license")
    
    for field in "${required_fields[@]}"; do
        local value=$(cat "$package_json" | jq -r ".$field // empty")
        if [[ -z "$value" ]]; then
            log_error "Missing required field '$field' in $package_json"
        fi
    done
    
    # Check scripts
    local build_script=$(cat "$package_json" | jq -r '.scripts.build // empty')
    if [[ -z "$build_script" ]]; then
        log_warning "Missing 'build' script in $package_json"
    fi
    
    local test_script=$(cat "$package_json" | jq -r '.scripts.test // empty')
    if [[ -z "$test_script" ]]; then
        log_warning "Missing 'test' script in $package_json"
    fi
    
    # Check publishConfig
    local registry=$(cat "$package_json" | jq -r '.publishConfig.registry // empty')
    if [[ -z "$registry" ]]; then
        log_warning "Missing publishConfig.registry in $package_json"
    fi
    
    local access=$(cat "$package_json" | jq -r '.publishConfig.access // empty')
    if [[ -z "$access" ]]; then
        log_warning "Missing publishConfig.access in $package_json"
    fi
}

# Validate build outputs
validate_build_outputs() {
    local package_dir="$1"
    local package_json="$2"
    
    local main_field=$(cat "$package_json" | jq -r '.main // empty')
    local types_field=$(cat "$package_json" | jq -r '.types // empty')
    
    # Check main entry point
    if [[ -n "$main_field" ]]; then
        local main_file="$package_dir/$main_field"
        if [[ ! -f "$main_file" ]]; then
            log_error "Main entry point not found: $main_file"
        else
            # Check if it's a valid JavaScript file
            if ! node -c "$main_file" 2>/dev/null; then
                log_error "Main entry point has syntax errors: $main_file"
            fi
        fi
    fi
    
    # Check TypeScript definitions
    if [[ -n "$types_field" ]]; then
        local types_file="$package_dir/$types_field"
        if [[ ! -f "$types_file" ]]; then
            log_error "TypeScript definitions not found: $types_file"
        fi
    fi
    
    # Check dist directory
    if [[ -d "$package_dir/dist" ]]; then
        local js_files=$(find "$package_dir/dist" -name "*.js" | wc -l)
        local dts_files=$(find "$package_dir/dist" -name "*.d.ts" | wc -l)
        
        if [[ $js_files -eq 0 ]]; then
            log_warning "No JavaScript files found in $package_dir/dist"
        fi
        
        if [[ $dts_files -eq 0 ]]; then
            log_warning "No TypeScript definition files found in $package_dir/dist"
        fi
    fi
}

# Validate TypeScript definitions
validate_typescript_definitions() {
    local package_dir="$1"
    local package_json="$2"
    
    # Check if package has TypeScript source
    if [[ -d "$package_dir/src" ]]; then
        local ts_files=$(find "$package_dir/src" -name "*.ts" | wc -l)
        
        if [[ $ts_files -gt 0 ]]; then
            # Check TypeScript compilation
            if [[ -f "$package_dir/tsconfig.json" ]]; then
                local temp_dir=$(mktemp -d)
                
                if ! npx tsc --project "$package_dir/tsconfig.json" --noEmit --outDir "$temp_dir" 2>/dev/null; then
                    log_error "TypeScript compilation failed for $package_dir"
                fi
                
                rm -rf "$temp_dir"
            else
                log_warning "TypeScript files found but no tsconfig.json in $package_dir"
            fi
        fi
    fi
}

# Validate package exports
validate_package_exports() {
    local package_dir="$1"
    local package_json="$2"
    
    local main_field=$(cat "$package_json" | jq -r '.main // empty')
    
    if [[ -n "$main_field" && -f "$package_dir/$main_field" ]]; then
        # Try to require the package
        local package_name=$(cat "$package_json" | jq -r '.name')
        local temp_test_file=$(mktemp).js
        
        cat > "$temp_test_file" << EOF
try {
  require('$package_dir/$main_field');
  console.log('SUCCESS');
} catch (error) {
  console.error('FAILED:', error.message);
  process.exit(1);
}
EOF
        
        if ! node "$temp_test_file" >/dev/null 2>&1; then
            log_error "Package export validation failed for $package_name"
        fi
        
        rm -f "$temp_test_file"
    fi
}

# Validate dependencies
validate_dependencies() {
    log "Validating dependencies..."
    
    # Check for security vulnerabilities
    if command -v npm audit &> /dev/null; then
        log "Running security audit..."
        
        if ! npm audit --audit-level moderate 2>/dev/null; then
            log_warning "Security vulnerabilities found in dependencies"
        fi
    fi
    
    # Check for outdated dependencies
    if command -v npm outdated &> /dev/null; then
        local outdated_count=$(npm outdated --json 2>/dev/null | jq 'length // 0')
        
        if [[ $outdated_count -gt 0 ]]; then
            log_warning "$outdated_count outdated dependencies found"
        fi
    fi
    
    # Check for duplicate dependencies
    if command -v npm ls &> /dev/null; then
        if ! npm ls --depth=0 >/dev/null 2>&1; then
            log_warning "Dependency tree has issues"
        fi
    fi
}

# Validate linting and formatting
validate_code_quality() {
    log "Validating code quality..."
    
    # Check linting
    if [[ -f ".eslintrc.js" || -f ".eslintrc.json" || -f "eslint.config.js" ]]; then
        if command -v eslint &> /dev/null; then
            if ! npm run lint >/dev/null 2>&1; then
                log_error "Linting validation failed"
            fi
        fi
    fi
    
    # Check formatting
    if [[ -f ".prettierrc" || -f "prettier.config.js" ]]; then
        if command -v prettier &> /dev/null; then
            if ! npx prettier --check "packages/*/src/**/*.{ts,js}" >/dev/null 2>&1; then
                log_error "Code formatting validation failed"
            fi
        fi
    fi
}

# Validate test coverage
validate_test_coverage() {
    log "Validating test coverage..."
    
    if [[ -f "coverage/lcov-report/index.html" ]]; then
        # Extract coverage percentage
        local coverage=$(grep -o 'headerCovTableEntryLo">[0-9.]*%' coverage/lcov-report/index.html | head -1 | grep -o '[0-9.]*' || echo "0")
        
        if (( $(echo "$coverage >= 80" | bc -l) )); then
            log_success "Test coverage: ${coverage}%"
        else
            log_warning "Test coverage below 80%: ${coverage}%"
        fi
    else
        log_warning "Coverage report not found"
    fi
}

# Validate documentation
validate_documentation() {
    log "Validating documentation..."
    
    # Check README files
    local packages=$(find packages -name "package.json" -not -path "*/node_modules/*" | sort)
    
    for package_json in $packages; do
        local package_dir=$(dirname "$package_json")
        local package_name=$(cat "$package_json" | jq -r '.name')
        
        if [[ ! -f "$package_dir/README.md" ]]; then
            log_warning "Missing README.md for package: $package_name"
        fi
    done
    
    # Check main project README
    if [[ ! -f "README.md" ]]; then
        log_warning "Missing main project README.md"
    fi
    
    # Check CHANGELOG
    if [[ ! -f "CHANGELOG.md" ]]; then
        log_warning "Missing CHANGELOG.md"
    fi
}

# Validate bundle sizes
validate_bundle_sizes() {
    log "Validating bundle sizes..."
    
    local packages=$(find packages -name "package.json" -not -path "*/node_modules/*" | sort)
    
    for package_json in $packages; do
        local package_dir=$(dirname "$package_json")
        local package_name=$(cat "$package_json" | jq -r '.name')
        
        if [[ -d "$package_dir/dist" ]]; then
            local total_size=$(du -sb "$package_dir/dist" | cut -f1)
            local size_mb=$((total_size / 1024 / 1024))
            
            # Warn if package is larger than 10MB
            if [[ $size_mb -gt 10 ]]; then
                log_warning "Large bundle size for $package_name: ${size_mb}MB"
            fi
        fi
    done
}

# Generate validation report
generate_validation_report() {
    log "Generating validation report..."
    
    local total_issues=$((VALIDATION_ERRORS + VALIDATION_WARNINGS))
    
    # Create validation report
    cat > "validation-report.json" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "summary": {
    "errors": $VALIDATION_ERRORS,
    "warnings": $VALIDATION_WARNINGS,
    "totalIssues": $total_issues
  },
  "validations": [
    "package_structure",
    "dependencies",
    "code_quality",
    "test_coverage",
    "documentation",
    "bundle_sizes"
  ],
  "status": "$(if [[ $VALIDATION_ERRORS -eq 0 ]]; then echo "PASSED"; else echo "FAILED"; fi)"
}
EOF
    
    # Print summary
    echo ""
    echo "========================================"
    echo "🔍 CAIA Build Validation Summary"
    echo "========================================"
    echo "Errors: $VALIDATION_ERRORS"
    echo "Warnings: $VALIDATION_WARNINGS"
    echo "Total Issues: $total_issues"
    echo "Validation Log: $VALIDATION_LOG"
    echo "Validation Report: validation-report.json"
    echo "========================================"
    
    if [[ $VALIDATION_ERRORS -eq 0 ]]; then
        log_success "Build validation completed successfully"
        return 0
    else
        log_error "Build validation failed with $VALIDATION_ERRORS errors"
        return 1
    fi
}

# Main execution
main() {
    init_validation
    
    validate_package_structure
    validate_dependencies
    validate_code_quality
    validate_test_coverage
    validate_documentation
    validate_bundle_sizes
    
    generate_validation_report
}

# Execute main function
main "$@"