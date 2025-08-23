# CAIA Knowledge System Tests

> Comprehensive test suite with 80%+ coverage for the knowledge management system

## Test Structure

```
tests/
├── unit/           # Unit tests for individual components
├── integration/    # End-to-end pipeline tests  
├── api/           # REST API endpoint tests
├── cli/           # Command-line interface tests
├── performance/   # Benchmarks and performance tests
├── fixtures/      # Test data and mock objects
├── conftest.py    # Pytest configuration
└── run_tests.py   # Test runner with coverage
```

## Running Tests

```bash
# Install test dependencies
pip3 install -r tests/requirements.txt

# Run all tests
python3 tests/run_tests.py

# Run with coverage
python3 tests/run_tests.py --coverage

# Run specific test categories
python3 tests/run_tests.py --unit
python3 tests/run_tests.py --integration
```

## Coverage Report

```bash
# Generate coverage report
./tests/generate-coverage.sh

# View HTML report
open tests/coverage/html/index.html
```

## Test Categories

- **Unit Tests**: Core component functionality
- **Integration Tests**: Full pipeline workflows
- **API Tests**: REST endpoint validation
- **CLI Tests**: Command-line interface
- **Performance Tests**: Speed and resource usage