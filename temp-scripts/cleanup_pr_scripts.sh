#!/bin/bash

# Clean up temporary PR creation scripts after successful PR creation

echo "🧹 Cleaning up temporary PR creation scripts..."

cd /Users/MAC/Documents/projects/caia/temp-scripts

# Remove the PR creation scripts - they're no longer needed
if [ -f "create_hierarchical_pr.sh" ]; then
    rm create_hierarchical_pr.sh
    echo "✅ Removed create_hierarchical_pr.sh"
fi

if [ -f "create_pr_with_gh.sh" ]; then
    rm create_pr_with_gh.sh  
    echo "✅ Removed create_pr_with_gh.sh"
fi

if [ -f "production-ready-parallel.sh" ]; then
    rm production-ready-parallel.sh
    echo "✅ Removed production-ready-parallel.sh"
fi

# Remove this cleanup script itself
rm cleanup_pr_scripts.sh
echo "✅ Removed cleanup_pr_scripts.sh"

echo "🎉 Temporary scripts cleaned up successfully!"
echo "📁 The temp-scripts folder is now clean and ready for future tasks."
