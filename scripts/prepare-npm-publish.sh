#!/bin/bash

# CAIA NPM Publishing Preparation Script
# This script validates and prepares all packages for NPM publishing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ROOT_DIR="/Users/MAC/Documents/projects/caia"
SCRIPTS_DIR="$ROOT_DIR/scripts"
PACKAGES_DIR="$ROOT_DIR/packages"
INITIAL_VERSION="0.1.0"

# Counters
TOTAL_PACKAGES=0
VALID_PACKAGES=0
INVALID_PACKAGES=0
MISSING_README=0
MISSING_TESTS=0

echo -e "${BLUE}🚀 CAIA NPM Publishing Preparation${NC}"
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

# Function to validate package.json
validate_package_json() {
    local package_file=$1
    local package_dir=$(dirname "$package_file")
    local package_name=$(basename "$package_dir")
    local parent_dir=$(basename "$(dirname "$package_dir")")
    
    log_info "Validating $package_file"
    
    # Check if package.json exists and is valid JSON
    if ! jq . "$package_file" > /dev/null 2>&1; then
        log_error "Invalid JSON in $package_file"
        return 1
    fi
    
    local name=$(jq -r '.name // "null"' "$package_file")
    local version=$(jq -r '.version // "null"' "$package_file")
    local description=$(jq -r '.description // "null"' "$package_file")
    local main=$(jq -r '.main // "null"' "$package_file")
    local types=$(jq -r '.types // "null"' "$package_file")
    local license=$(jq -r '.license // "null"' "$package_file")
    local repository=$(jq -r '.repository // "null"' "$package_file")
    local publishConfig=$(jq -r '.publishConfig.access // "null"' "$package_file")
    
    # Validation flags
    local validation_passed=true
    
    # Check @caia scope
    if [[ ! "$name" =~ ^@caia/ ]]; then
        log_error "Package name '$name' should start with '@caia/'"
        validation_passed=false
    fi
    
    # Check version
    if [[ "$version" == "null" ]]; then
        log_warning "No version specified for $name, will set to $INITIAL_VERSION"
        # Update version in package.json
        jq ".version = \"$INITIAL_VERSION\"" "$package_file" > "$package_file.tmp" && mv "$package_file.tmp" "$package_file"
    fi
    
    # Check description
    if [[ "$description" == "null" || "$description" == "" ]]; then
        log_warning "Missing description for $name"
    fi
    
    # Check main entry point
    if [[ "$main" == "null" ]]; then
        log_warning "Missing main entry point for $name"
    fi
    
    # Check types
    if [[ "$types" == "null" ]]; then
        log_warning "Missing types declaration for $name"
    fi
    
    # Check license
    if [[ "$license" == "null" ]]; then
        log_error "Missing license for $name"
        validation_passed=false
    fi
    
    # Check repository
    if [[ "$repository" == "null" ]]; then
        log_warning "Missing repository for $name"
    fi
    
    # Check publishConfig
    if [[ "$publishConfig" == "null" ]]; then
        log_warning "Missing publishConfig.access for $name, adding public access"
        # Add publishConfig
        jq '.publishConfig = {"access": "public"}' "$package_file" > "$package_file.tmp" && mv "$package_file.tmp" "$package_file"
    fi
    
    # Check README
    local readme_file="$package_dir/README.md"
    if [[ ! -f "$readme_file" ]]; then
        log_warning "Missing README.md for $name"
        ((MISSING_README++))
    fi
    
    # Check for test files
    if [[ ! -d "$package_dir/src/__tests__" && ! -d "$package_dir/tests" && ! -d "$package_dir/test" ]]; then
        log_warning "No test directory found for $name"
        ((MISSING_TESTS++))
    fi
    
    if [[ "$validation_passed" == "true" ]]; then
        log_success "Package $name validated successfully"
        ((VALID_PACKAGES++))
        return 0
    else
        log_error "Package $name failed validation"
        ((INVALID_PACKAGES++))
        return 1
    fi
}

# Function to ensure standard package.json structure
standardize_package_json() {
    local package_file=$1
    local temp_file="$package_file.tmp"
    
    log_info "Standardizing $package_file"
    
    # Use jq to ensure consistent structure
    jq '{
        name: .name,
        version: .version,
        description: .description,
        main: .main,
        types: .types,
        exports: .exports,
        bin: .bin,
        scripts: .scripts,
        keywords: .keywords,
        author: (.author // "CAIA Team"),
        license: (.license // "MIT"),
        dependencies: .dependencies,
        devDependencies: .devDependencies,
        peerDependencies: .peerDependencies,
        files: (.files // ["dist/**/*", "README.md"]),
        repository: .repository,
        engines: (.engines // {"node": ">=18.0.0"}),
        publishConfig: (.publishConfig // {"access": "public"})
    } | with_entries(select(.value != null))' "$package_file" > "$temp_file"
    
    mv "$temp_file" "$package_file"
}

# Function to check dependencies
check_dependencies() {
    local package_file=$1
    local package_dir=$(dirname "$package_file")
    
    log_info "Checking dependencies for $(jq -r '.name' "$package_file")"
    
    # Check if dependencies exist in the workspace
    local deps=$(jq -r '.dependencies // {} | keys[]' "$package_file" 2>/dev/null || echo "")
    
    for dep in $deps; do
        if [[ "$dep" =~ ^@caia/ ]]; then
            # Check if this workspace dependency exists
            local dep_found=false
            for pkg_json in $(find "$ROOT_DIR" -name "package.json" -not -path "*/node_modules/*"); do
                local pkg_name=$(jq -r '.name' "$pkg_json" 2>/dev/null || echo "")
                if [[ "$pkg_name" == "$dep" ]]; then
                    dep_found=true
                    break
                fi
            done
            
            if [[ "$dep_found" == "false" ]]; then
                log_warning "Workspace dependency $dep not found for $(jq -r '.name' "$package_file")"
            fi
        fi
    done
}

# Function to create summary report
create_summary_report() {
    log_info "Creating summary report..."
    
    local report_file="$ROOT_DIR/npm-publish-report.md"
    
    cat > "$report_file" << EOF
# CAIA NPM Publishing Preparation Report

Generated on: $(date)

## Summary

- **Total Packages**: $TOTAL_PACKAGES
- **Valid Packages**: $VALID_PACKAGES
- **Invalid Packages**: $INVALID_PACKAGES
- **Missing README**: $MISSING_README
- **Missing Tests**: $MISSING_TESTS

## Package Status

EOF

    # Add package details
    for package_file in $(find "$ROOT_DIR" -name "package.json" -not -path "*/node_modules/*" -not -path "$ROOT_DIR/package.json"); do
        local name=$(jq -r '.name' "$package_file" 2>/dev/null || echo "unknown")
        local version=$(jq -r '.version' "$package_file" 2>/dev/null || echo "unknown")
        local description=$(jq -r '.description' "$package_file" 2>/dev/null || echo "No description")
        
        echo "### $name" >> "$report_file"
        echo "- **Version**: $version" >> "$report_file"
        echo "- **Description**: $description" >> "$report_file"
        echo "- **Path**: $(dirname "$package_file")" >> "$report_file"
        echo "" >> "$report_file"
    done
    
    cat >> "$report_file" << EOF

## Next Steps

1. Review invalid packages and fix issues
2. Add missing README files
3. Add test suites to packages without tests
4. Run \`npm run publish:dry-run\` to test publishing
5. Run \`npm run publish:all\` when ready

## Publishing Order

The packages should be published in this order to respect dependencies:

1. Core packages first
2. Utilities and modules
3. Engines
4. Agents
5. Integrations

EOF

    log_success "Summary report created at $report_file"
}

# Main execution
main() {
    cd "$ROOT_DIR"
    
    log_info "Starting NPM publishing preparation for CAIA packages"
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed. Please install jq first."
        exit 1
    fi
    
    # Find all package.json files (excluding root and node_modules)
    log_info "Discovering packages..."
    
    local package_files=()
    while IFS= read -r -d '' file; do
        # Skip root package.json and node_modules
        if [[ "$file" != "$ROOT_DIR/package.json" && "$file" != *"/node_modules/"* ]]; then
            package_files+=("$file")
            ((TOTAL_PACKAGES++))
        fi
    done < <(find "$ROOT_DIR" -name "package.json" -type f -print0)
    
    log_info "Found $TOTAL_PACKAGES packages to validate"
    
    # Validate each package
    for package_file in "${package_files[@]}"; do
        echo ""
        validate_package_json "$package_file"
        standardize_package_json "$package_file"
        check_dependencies "$package_file"
    done
    
    echo ""
    echo "================================================="
    log_info "Validation Summary:"
    echo "  Total packages: $TOTAL_PACKAGES"
    echo "  Valid packages: $VALID_PACKAGES"
    echo "  Invalid packages: $INVALID_PACKAGES"
    echo "  Missing README: $MISSING_README"
    echo "  Missing tests: $MISSING_TESTS"
    
    # Create summary report
    create_summary_report
    
    if [[ $INVALID_PACKAGES -gt 0 ]]; then
        log_error "Some packages failed validation. Please fix the issues before publishing."
        exit 1
    else
        log_success "All packages are ready for publishing!"
        log_info "Next step: Run npm-publish.sh for actual publishing"
    fi
}

# Execute main function
main "$@"