#!/bin/bash

# Build script for CAIA agents
set -e

echo "🏗️  Building CAIA Agents..."

# Function to build a package
build_package() {
    local package_dir=$1
    local package_name=$2
    
    echo ""
    echo "📦 Building $package_name..."
    cd "$package_dir"
    
    # Install dependencies
    if [ -f "package.json" ]; then
        echo "   Installing dependencies..."
        npm install
        
        # Run build script if it exists
        if npm run build > /dev/null 2>&1; then
            echo "   Building package..."
            npm run build
        fi
        
        # Run tests if they exist
        if npm run test > /dev/null 2>&1; then
            echo "   Running tests..."
            npm test
        fi
        
        # Check if package is ready for publishing
        echo "   Checking package readiness..."
        npm pack --dry-run > /dev/null 2>&1 && echo "   ✅ Package is ready for publishing" || echo "   ❌ Package has issues"
    else
        echo "   ❌ No package.json found"
    fi
    
    cd - > /dev/null
}

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Build jira-connect agent
build_package "$SCRIPT_DIR/jira-connect" "@caia/agent-jira-connect"

# Build product-owner agent
build_package "$SCRIPT_DIR/product-owner" "@caia/agent-product-owner"

echo ""
echo "🎉 Agent build process complete!"
echo ""
echo "📋 Next Steps:"
echo "   1. Review packages in their respective directories"
echo "   2. Test agents manually if needed"
echo "   3. Publish to npm when ready:"
echo "      cd jira-connect && npm publish"
echo "      cd product-owner && npm publish"
echo ""
echo "🔗 Package locations:"
echo "   • @caia/agent-jira-connect: $SCRIPT_DIR/jira-connect"
echo "   • @caia/agent-product-owner: $SCRIPT_DIR/product-owner"