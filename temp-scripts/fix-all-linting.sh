#!/bin/bash

# Fix linting errors for all utility packages in parallel
echo "🔧 Fixing linting errors for all packages in parallel..."
echo "================================================"

# Array of utility packages
UTILITIES=(
  "packages/utils/work-divider"
  "packages/utils/resource-calculator"
  "packages/utils/coverage-aggregator"
  "packages/utils/metric-collector"
  "packages/utils/progress-tracker"
  "packages/utils/task-scheduler"
  "packages/utils/dependency-analyzer"
  "packages/utils/report-generator"
  "packages/utils/pattern-recognizer"
  "packages/tools/test-runner"
)

# Function to fix linting for a package
fix_lint() {
  local pkg=$1
  local name=$(basename $pkg)
  
  cd "$pkg" 2>/dev/null || {
    echo "❌ $name: Directory not found"
    return 1
  }
  
  echo "🔧 Fixing $name..."
  
  # Run lint fix
  npm run lint:fix > /dev/null 2>&1
  
  # Check if lint passes now
  npm run lint > /dev/null 2>&1
  local exit_code=$?
  
  if [ $exit_code -eq 0 ]; then
    echo "✅ $name: Linting fixed"
  else
    echo "⚠️ $name: Some linting issues remain (manual fix needed)"
  fi
  
  return 0
}

export -f fix_lint

echo "Fixing linting for ${#UTILITIES[@]} packages in parallel..."
echo ""

# Start all fixes in background
pids=()
for pkg in "${UTILITIES[@]}"; do
  (fix_lint "$pkg") &
  pids+=($!)
done

# Wait for all fixes to complete
for pid in "${pids[@]}"; do
  wait $pid
done

echo ""
echo "================================================"
echo "✅ Linting fixes attempted for all packages"
echo ""
echo "Now running final lint check..."
echo ""

# Final check
cd /Users/MAC/Documents/projects/caia
npx lerna run lint --parallel 2>&1 | grep -c "Lifecycle script \`lint\` failed" | read failures

if [ "$failures" == "0" ]; then
  echo "✅ All packages pass linting!"
else
  echo "⚠️ Some packages still have linting issues. Running detailed check..."
  
  # Check each package
  for pkg in "${UTILITIES[@]}"; do
    cd "/Users/MAC/Documents/projects/caia/$pkg" 2>/dev/null
    npm run lint > /tmp/lint_output_$(basename $pkg).txt 2>&1
    if [ $? -ne 0 ]; then
      echo ""
      echo "❌ $(basename $pkg) has linting errors:"
      cat /tmp/lint_output_$(basename $pkg).txt | grep "error" | head -5
    fi
  done
fi