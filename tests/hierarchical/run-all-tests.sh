#!/bin/bash

# Hierarchical Agent System - Complete Test Suite Runner
# Executes all test suites with CC Orchestrator integration

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEST_DIR="$SCRIPT_DIR"
COVERAGE_DIR="$TEST_DIR/coverage"
RESULTS_DIR="$TEST_DIR/results"

echo -e "${BLUE}🧪 Hierarchical Agent System - Complete Test Suite${NC}\n"

# Function to print status
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Parse command line arguments
SUITE="all"
MAX_WORKERS="auto"
VERBOSE=false
COVERAGE=true
PARALLEL=true
TIMEOUT=300000
RETRIES=0
CONTINUE_ON_FAILURE=false
GENERATE_FIXTURES=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --suite)
            SUITE="$2"
            shift 2
            ;;
        --max-workers)
            MAX_WORKERS="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --no-coverage)
            COVERAGE=false
            shift
            ;;
        --no-parallel)
            PARALLEL=false
            shift
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --retries)
            RETRIES="$2"
            shift 2
            ;;
        --continue-on-failure)
            CONTINUE_ON_FAILURE=true
            shift
            ;;
        --no-fixtures)
            GENERATE_FIXTURES=false
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --suite <suite>           Test suite to run (all|unit|integration|performance|e2e)"
            echo "  --max-workers <count>     Maximum worker processes"
            echo "  --verbose                 Verbose output"
            echo "  --no-coverage            Disable coverage reporting"
            echo "  --no-parallel            Disable parallel execution"
            echo "  --timeout <ms>           Test timeout in milliseconds"
            echo "  --retries <count>        Number of retries for failed tests"
            echo "  --continue-on-failure    Continue after test failures"
            echo "  --no-fixtures            Skip fixture generation"
            echo "  --help                   Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Run all tests with defaults"
            echo "  $0 --suite unit                     # Run only unit tests"
            echo "  $0 --suite unit,integration         # Run unit and integration tests"
            echo "  $0 --no-coverage --verbose          # Run without coverage, verbose output"
            echo "  $0 --max-workers 16 --parallel      # Run with 16 workers in parallel"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

print_status "Configuration:"
print_status "  Suite: $SUITE"
print_status "  Max Workers: $MAX_WORKERS"
print_status "  Verbose: $VERBOSE"
print_status "  Coverage: $COVERAGE"
print_status "  Parallel: $PARALLEL"
print_status "  Timeout: ${TIMEOUT}ms"
print_status "  Retries: $RETRIES"
echo ""

# Check prerequisites
print_status "Checking prerequisites..."

if ! command_exists node; then
    print_error "Node.js not found. Please install Node.js 18+."
    exit 1
fi

if ! command_exists npm; then
    print_error "npm not found. Please install npm."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR_VERSION=$(echo $NODE_VERSION | cut -d. -f1)
if [ "$NODE_MAJOR_VERSION" -lt 18 ]; then
    print_error "Node.js version 18+ required. Found: $NODE_VERSION"
    exit 1
fi

print_success "Node.js version: $NODE_VERSION"

# Navigate to test directory
cd "$TEST_DIR"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found in test directory"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    print_status "Installing test dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        print_error "Failed to install dependencies"
        exit 1
    fi
    print_success "Dependencies installed"
fi

# Create results directory
mkdir -p "$RESULTS_DIR"
mkdir -p "$COVERAGE_DIR"

# Generate test fixtures if needed
if [ "$GENERATE_FIXTURES" = true ]; then
    print_status "Generating test fixtures..."
    
    if [ -f "fixtures/data-generator.js" ]; then
        node fixtures/data-generator.js
        if [ $? -eq 0 ]; then
            print_success "Test fixtures generated"
        else
            print_warning "Failed to generate fixtures, continuing with existing data"
        fi
    else
        print_warning "Data generator not found, skipping fixture generation"
    fi
fi

# Set environment variables
export NODE_ENV=test
export LOG_LEVEL=error
export JIRA_MOCK_MODE=true

# CC Orchestrator settings
export CCO_AUTO_INVOKE=true
export CCO_AUTO_CALCULATE=true
export CCO_TASK_TIMEOUT=$TIMEOUT
export CCO_CONTEXT_PRESERVATION=true

if [ "$VERBOSE" = true ]; then
    export CCO_DEBUG=true
fi

# Increase Node.js memory limit for large test suites
if [ "$SUITE" = "performance" ] || [ "$SUITE" = "all" ]; then
    export NODE_OPTIONS="--max-old-space-size=8192"
    print_status "Increased Node.js memory limit for performance tests"
fi

# Build test runner arguments
RUNNER_ARGS="--suite $SUITE"

if [ "$MAX_WORKERS" != "auto" ]; then
    RUNNER_ARGS="$RUNNER_ARGS --maxWorkers $MAX_WORKERS"
fi

if [ "$VERBOSE" = true ]; then
    RUNNER_ARGS="$RUNNER_ARGS --verbose"
fi

if [ "$COVERAGE" = false ]; then
    RUNNER_ARGS="$RUNNER_ARGS --no-coverage"
fi

if [ "$PARALLEL" = false ]; then
    RUNNER_ARGS="$RUNNER_ARGS --no-parallel"
fi

if [ "$TIMEOUT" != "300000" ]; then
    RUNNER_ARGS="$RUNNER_ARGS --timeout $TIMEOUT"
fi

if [ "$RETRIES" != "0" ]; then
    RUNNER_ARGS="$RUNNER_ARGS --retries $RETRIES"
fi

if [ "$CONTINUE_ON_FAILURE" = true ]; then
    RUNNER_ARGS="$RUNNER_ARGS --continue-on-failure"
fi

# Record start time
START_TIME=$(date +%s)

print_status "Starting test execution..."
print_status "Command: node src/test-runner.js $RUNNER_ARGS"
echo ""

# Run tests with the test runner
node src/test-runner.js $RUNNER_ARGS
TEST_EXIT_CODE=$?

# Record end time
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
print_status "Test execution completed in ${DURATION}s"

# Generate final summary
if [ -f "test-results.json" ]; then
    print_status "Test results saved to: test-results.json"
fi

if [ "$COVERAGE" = true ] && [ -d "$COVERAGE_DIR" ]; then
    print_status "Coverage reports available in: $COVERAGE_DIR"
    
    # Find HTML coverage report
    if [ -f "$COVERAGE_DIR/lcov-report/index.html" ]; then
        print_status "HTML Coverage Report: $COVERAGE_DIR/lcov-report/index.html"
    fi
fi

# Performance analysis
if [ $DURATION -lt 60 ]; then
    print_success "Excellent performance: ${DURATION}s (< 1 minute)"
elif [ $DURATION -lt 300 ]; then
    print_status "Good performance: ${DURATION}s (1-5 minutes)"
else
    print_warning "Slow performance: ${DURATION}s (> 5 minutes)"
fi

# CC Orchestrator usage check
if command_exists node && [ -f "$PROJECT_ROOT/utils/parallel/cc-orchestrator/src/index.js" ]; then
    if [ "$PARALLEL" = true ]; then
        print_success "CC Orchestrator integration available and used"
    else
        print_warning "CC Orchestrator available but parallel execution disabled"
    fi
else
    print_warning "CC Orchestrator not found - using basic parallel execution"
fi

# Final status
echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
    print_success "🎉 All tests completed successfully!"
    
    # Optional: Open coverage report
    if [ "$COVERAGE" = true ] && [ -f "$COVERAGE_DIR/lcov-report/index.html" ]; then
        if command_exists open; then  # macOS
            echo ""
            read -p "Open coverage report in browser? (y/n): " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                open "$COVERAGE_DIR/lcov-report/index.html"
            fi
        fi
    fi
else
    print_error "💥 Tests failed with exit code: $TEST_EXIT_CODE"
    
    if [ "$VERBOSE" = false ]; then
        print_status "Run with --verbose for detailed error information"
    fi
fi

# Cleanup
if [ -f "test-results.json" ]; then
    mv "test-results.json" "$RESULTS_DIR/test-results-$(date +%Y%m%d-%H%M%S).json"
fi

exit $TEST_EXIT_CODE