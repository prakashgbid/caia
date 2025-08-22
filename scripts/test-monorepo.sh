#!/bin/bash

# CAIA Monorepo Parallel Testing Script
# Runs all tests in parallel with live dashboard

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 CAIA Monorepo Parallel Testing System${NC}"
echo "================================================"

# Default values
DASHBOARD_TYPE="terminal"
MAX_PARALLEL="auto"
COVERAGE_THRESHOLD="95"
STRATEGY="complexity"
VERBOSE=""
BAIL=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --web)
      DASHBOARD_TYPE="web"
      shift
      ;;
    --both)
      DASHBOARD_TYPE="both"
      shift
      ;;
    --no-dashboard)
      DASHBOARD_TYPE="none"
      shift
      ;;
    --parallel)
      MAX_PARALLEL="$2"
      shift 2
      ;;
    --coverage)
      COVERAGE_THRESHOLD="$2"
      shift 2
      ;;
    --strategy)
      STRATEGY="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE="--verbose"
      shift
      ;;
    --bail)
      BAIL="--bail"
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --web              Use web dashboard (default: terminal)"
      echo "  --both             Use both terminal and web dashboards"
      echo "  --no-dashboard     Run without dashboard"
      echo "  --parallel <n>     Max parallel workers (default: auto)"
      echo "  --coverage <n>     Coverage threshold percentage (default: 95)"
      echo "  --strategy <s>     Sharding strategy: size, complexity, dependencies (default: complexity)"
      echo "  --verbose          Verbose output"
      echo "  --bail             Stop on first failure"
      echo "  --help             Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0                           # Run with terminal dashboard"
      echo "  $0 --web                     # Run with web dashboard"
      echo "  $0 --parallel 10 --bail      # Run with 10 workers, stop on failure"
      echo "  $0 --no-dashboard --verbose  # Run without dashboard, verbose output"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Check if orchestrator is built
ORCHESTRATOR_PATH="packages/tools/monorepo-test-orchestrator"
if [ ! -d "$ORCHESTRATOR_PATH/dist" ]; then
  echo -e "${YELLOW}⚠️  Orchestrator not built. Building now...${NC}"
  cd "$ORCHESTRATOR_PATH"
  npm run build
  cd - > /dev/null
fi

# Ensure dependencies are installed
echo -e "${BLUE}📦 Checking dependencies...${NC}"
npm install --silent 2>/dev/null || true

# Run the orchestrator
echo -e "${GREEN}✅ Starting test orchestrator...${NC}"
echo "Dashboard: $DASHBOARD_TYPE"
echo "Max Parallel: $MAX_PARALLEL"
echo "Coverage Threshold: $COVERAGE_THRESHOLD%"
echo "Strategy: $STRATEGY"
echo ""

# Build the command
CMD="node $ORCHESTRATOR_PATH/dist/cli.js run"
CMD="$CMD --dashboard $DASHBOARD_TYPE"
CMD="$CMD --parallel $MAX_PARALLEL"
CMD="$CMD --coverage $COVERAGE_THRESHOLD"
CMD="$CMD --strategy $STRATEGY"

if [ -n "$VERBOSE" ]; then
  CMD="$CMD --verbose"
fi

if [ -n "$BAIL" ]; then
  CMD="$CMD --bail"
fi

# Execute
exec $CMD