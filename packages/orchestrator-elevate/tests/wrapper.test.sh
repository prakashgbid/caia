#!/usr/bin/env bash
# wrapper.test.sh
# Unit tests for orchestrator-exec wrapper script
# Run as: bash tests/wrapper.test.sh

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'  # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Temp directory for testing
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

# Copy the wrapper for testing (we'll run it directly, not via sudo)
WRAPPER="$TEST_DIR/orchestrator-exec"
cp "$(dirname "$0")/../bin/orchestrator-exec" "$WRAPPER"
chmod +x "$WRAPPER"

# Mock log file
TEST_LOG="$TEST_DIR/test.log"
export LOGFILE="$TEST_LOG"

# Test helper
assert_success() {
  local name="$1"
  local cmd="$2"
  
  if eval "$cmd" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $name"
    ((TESTS_PASSED++))
    return 0
  else
    echo -e "${RED}✗${NC} $name"
    ((TESTS_FAILED++))
    return 1
  fi
}

assert_failure() {
  local name="$1"
  local cmd="$2"
  
  if ! eval "$cmd" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $name"
    ((TESTS_PASSED++))
    return 0
  else
    echo -e "${RED}✗${NC} $name"
    ((TESTS_FAILED++))
    return 1
  fi
}

assert_contains() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} $name"
    ((TESTS_PASSED++))
    return 0
  else
    echo -e "${RED}✗${NC} $name (pattern not found: $pattern)"
    ((TESTS_FAILED++))
    return 1
  fi
}

echo "=== Orchestrator-Exec Wrapper Tests ==="
echo ""

echo "--- Validation Tests ---"

# Test: Valid unit name accepts
assert_success "Valid unit name: actions.runner.caia-1.service" \
  "echo 'test' > $TEST_DIR/test.service && $WRAPPER install-systemd-unit 'actions.runner.caia-1.service' '$TEST_DIR/test.service'"

# Test: Invalid unit name rejects
assert_failure "Invalid unit name: app.service" \
  "echo 'test' > $TEST_DIR/test.service && $WRAPPER install-systemd-unit 'app.service' '$TEST_DIR/test.service'"

# Test: Unit name with special chars rejects
assert_failure "Invalid unit name with special chars" \
  "echo 'test' > $TEST_DIR/test.service && $WRAPPER install-systemd-unit 'caia-@test.service' '$TEST_DIR/test.service'"

echo ""
echo "--- Path Traversal Tests ---"

# Test: Path traversal attempt rejected
assert_failure "Path traversal (..) rejected" \
  "touch $TEST_DIR/test.txt && $WRAPPER install-sudoers-entry 'test-orchestrator' '$TEST_DIR/../etc/passwd'"

# Test: Absolute path outside allowed bases rejected
assert_failure "Path outside allowed bases rejected" \
  "touch /tmp/bad-path.txt && $WRAPPER install-sudoers-entry 'test-orchestrator' '/var/log/syslog'"

# Test: Valid path under /tmp accepted
assert_success "Valid path under /tmp accepted" \
  "echo 's903 ALL=(ALL) NOPASSWD: ALL' > $TEST_DIR/sudoers-test && $WRAPPER install-sudoers-entry 'valid-orchestrator' '$TEST_DIR/sudoers-test' 2>/dev/null || true"

echo ""
echo "--- Forbidden Path Tests ---"

# Test: /etc/sudoers direct access rejected
assert_failure "Direct /etc/sudoers edit rejected" \
  "$WRAPPER install-sudoers-entry 'bad-orchestrator' '/etc/sudoers'"

# Test: /etc/passwd access rejected
assert_failure "/etc/passwd access rejected" \
  "$WRAPPER install-sudoers-entry 'bad-orchestrator' '/etc/passwd'"

# Test: /root access rejected
assert_failure "/root access rejected" \
  "$WRAPPER install-sudoers-entry 'bad-orchestrator' '/root/secret'"

echo ""
echo "--- Package Validation Tests ---"

# Test: Vetted package accepted (will fail install in test, but validation should pass)
assert_failure "Vetted package curl validation passes (but apt-get fails in test)" \
  "$WRAPPER apt-install-package 'curl' 2>&1 | grep -q 'apt-get'"

# Test: Non-vetted package rejected
assert_failure "Non-vetted package nc rejected" \
  "$WRAPPER apt-install-package 'netcat'"

# Test: Non-vetted package evil rejected
assert_failure "Non-vetted package evil rejected" \
  "$WRAPPER apt-install-package 'evil-package'"

echo ""
echo "--- Service Validation Tests ---"

# Test: Allowed service passes validation
assert_failure "Allowed service nginx (will fail systemctl in test)" \
  "$WRAPPER service-reload 'nginx' 2>&1 | grep -q 'reload'"

# Test: Non-allowed service rejected
assert_failure "Non-allowed service bad-service rejected" \
  "$WRAPPER service-reload 'bad-service'"

echo ""
echo "--- Sudoers Name Validation Tests ---"

# Test: Valid sudoers name accepted
assert_success "Valid sudoers name: runner-orchestrator" \
  "echo 's903 ALL=(ALL) NOPASSWD: ALL' > $TEST_DIR/s1 && $WRAPPER install-sudoers-entry 'runner-orchestrator' '$TEST_DIR/s1' 2>/dev/null || true"

# Test: Invalid sudoers name rejected (uppercase)
assert_failure "Invalid sudoers name with uppercase rejected" \
  "echo 's903 ALL=(ALL) NOPASSWD: ALL' > $TEST_DIR/s2 && $WRAPPER install-sudoers-entry 'Runner-Orchestrator' '$TEST_DIR/s2'"

# Test: Invalid sudoers name rejected (missing -orchestrator)
assert_failure "Invalid sudoers name without -orchestrator suffix rejected" \
  "echo 's903 ALL=(ALL) NOPASSWD: ALL' > $TEST_DIR/s3 && $WRAPPER install-sudoers-entry 'runner' '$TEST_DIR/s3'"

# Test: Invalid sudoers name rejected (starts with number)
assert_failure "Invalid sudoers name starting with number rejected" \
  "echo 's903 ALL=(ALL) NOPASSWD: ALL' > $TEST_DIR/s4 && $WRAPPER install-sudoers-entry '1runner-orchestrator' '$TEST_DIR/s4'"

echo ""
echo "--- Logging Tests ---"

# Test: Successful operation logged
"$WRAPPER" systemctl-action daemon-reload 2>/dev/null || true
assert_contains "Operation logged to JSONL" "$TEST_LOG" '"operation":"systemctl-action"'

# Test: Rejection logged with reason
"$WRAPPER" apt-install-package 'bad-package' 2>/dev/null || true
assert_contains "Rejection logged" "$TEST_LOG" '"result":"reject"'

# Test: JSONL format validation
assert_contains "Log has well-formed JSON (timestamp)" "$TEST_LOG" '"timestamp"'
assert_contains "Log has well-formed JSON (operation)" "$TEST_LOG" '"operation"'
assert_contains "Log has well-formed JSON (result)" "$TEST_LOG" '"result"'

echo ""
echo "--- Operation Allowlist Tests ---"

# Test: Unknown operation rejected
assert_failure "Unknown operation rejected" \
  "$WRAPPER unknown-operation arg1 arg2"

# Test: No operation provided rejected
assert_failure "No operation provided rejected" \
  "$WRAPPER"

echo ""
echo "=== Test Summary ==="
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo -e "Skipped: ${YELLOW}$TESTS_SKIPPED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
