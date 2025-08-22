#!/bin/bash

# Run tests for all utility packages in parallel with coverage
echo "🚀 Running tests for all packages in parallel..."
echo "================================================"

# Array of packages
PACKAGES=(
  "packages/utils/work-divider"
  "packages/utils/resource-calculator"
  "packages/utils/coverage-aggregator"
  "packages/utils/metric-collector"
  "packages/utils/progress-tracker"
  "packages/utils/task-scheduler"
  "packages/utils/dependency-analyzer"
  "packages/utils/report-generator"
  "packages/utils/pattern-recognizer"
)

# Function to run test for a package
run_test() {
  local pkg=$1
  local name=$(basename $pkg)
  echo "🧪 Testing $name..."
  
  cd "$pkg" 2>/dev/null || {
    echo "❌ $name: Directory not found"
    return 1
  }
  
  # Run test with coverage
  npm test -- --coverage --silent 2>&1 | tail -n 20
  local exit_code=$?
  
  if [ $exit_code -eq 0 ]; then
    echo "✅ $name: Tests passed"
  else
    echo "❌ $name: Tests failed"
  fi
  
  return $exit_code
}

export -f run_test

# Run all tests in parallel
echo "Running ${#PACKAGES[@]} test suites in parallel..."
echo ""

# Use GNU parallel if available, otherwise use background processes
if command -v parallel &> /dev/null; then
  echo "Using GNU parallel for maximum performance..."
  printf '%s\n' "${PACKAGES[@]}" | parallel -j ${#PACKAGES[@]} run_test {}
else
  echo "Using background processes..."
  
  # Start all tests in background
  pids=()
  for pkg in "${PACKAGES[@]}"; do
    (run_test "$pkg") &
    pids+=($!)
  done
  
  # Wait for all tests to complete
  failed=0
  for pid in "${pids[@]}"; do
    wait $pid
    if [ $? -ne 0 ]; then
      failed=$((failed + 1))
    fi
  done
  
  echo ""
  echo "================================================"
  echo "📊 Test Summary:"
  echo "Total packages: ${#PACKAGES[@]}"
  echo "Failed: $failed"
  echo "Passed: $((${#PACKAGES[@]} - failed))"
  
  if [ $failed -gt 0 ]; then
    echo "❌ Some tests failed"
    exit 1
  else
    echo "✅ All tests passed!"
  fi
fi