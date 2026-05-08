#!/usr/bin/env bash
# wrapper.test.sh
# Unit tests for orchestrator-exec wrapper script
# Run as: bash tests/wrapper.test.sh

# errexit OFF — assert_* helpers return 1 on failure to track counters; we
# want to keep running through all tests. The script exit code is driven
# explicitly by $TESTS_FAILED at the bottom.
set -uo pipefail

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

# Mock log file
TEST_LOG="$TEST_DIR/test.log"
export LOGFILE="$TEST_LOG"

# Copy the wrapper for testing (we'll run it directly, not via sudo).
# The wrapper declares LOGFILE as `readonly` at the top, so we patch the copy
# to point at the test log instead of /var/log/orchestrator-exec.log. This
# keeps the source script unchanged but makes the audit log inspectable.
WRAPPER="$TEST_DIR/orchestrator-exec"
cp "$(dirname "$0")/../bin/orchestrator-exec" "$WRAPPER"
# BSD-portable in-place sed (works on macOS and GNU)
sed -i.bak "s|^readonly LOGFILE=.*|readonly LOGFILE=\"$TEST_LOG\"|" "$WRAPPER"
rm -f "$WRAPPER.bak"
chmod +x "$WRAPPER"

# Test helper
assert_success() {
  local name="$1"
  local cmd="$2"
  
  if eval "$cmd" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $name"
    ((TESTS_PASSED+=1))
    return 0
  else
    echo -e "${RED}✗${NC} $name"
    ((TESTS_FAILED+=1))
    return 1
  fi
}

assert_failure() {
  local name="$1"
  local cmd="$2"
  
  if ! eval "$cmd" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $name"
    ((TESTS_PASSED+=1))
    return 0
  else
    echo -e "${RED}✗${NC} $name"
    ((TESTS_FAILED+=1))
    return 1
  fi
}

assert_contains() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} $name"
    ((TESTS_PASSED+=1))
    return 0
  else
    echo -e "${RED}✗${NC} $name (pattern not found: $pattern)"
    ((TESTS_FAILED+=1))
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
echo "--- Duration Tests ---"

# Test: duration_ms field is present in log records
assert_contains "duration_ms field present" "$TEST_LOG" '"duration_ms":'

# Test: duration_ms is a small millisecond duration, NOT a unix timestamp.
#
# Pre-fix bug: log_operation used `date +%s` (seconds since epoch). When the
# implicit start_ms argument was 0 (the default — no caller threaded it in),
# duration_ms was logged as `end_seconds - 0 = current_unix_timestamp`, which
# is roughly 1.78e9 in 2026. Audit log entries showed values like
# "duration_ms":1778193195 — clearly a wall-clock timestamp, not a duration.
#
# Post-fix: log_operation uses date +%s%N (nanoseconds) at start (in main)
# and end (in log_operation), then computes ms = (end_ns - start_ns) / 1e6.
# A wrapper invocation that fails fast (validation reject) completes in well
# under a second, so duration_ms must be < 60000 ms. The threshold of 100000
# (100 seconds) gives plenty of headroom for slow CI while still being orders
# of magnitude below any plausible unix-timestamp value.
duration_test_log="$TEST_DIR/duration-check.log"
# Run a fast operation (rejected, so ~no real work) and capture its log line.
# We re-use $TEST_LOG and grab the most recent record.
"$WRAPPER" apt-install-package 'evil-pkg-for-duration' 2>/dev/null || true
last_duration_ms=$(tail -n 1 "$TEST_LOG" 2>/dev/null | grep -oE '"duration_ms":[0-9]+' | grep -oE '[0-9]+' || echo "")
if [ -z "$last_duration_ms" ]; then
  echo -e "${RED}✗${NC} duration_ms could not be parsed from log"
  ((TESTS_FAILED+=1))
elif [ "$last_duration_ms" -ge 100000 ]; then
  echo -e "${RED}✗${NC} duration_ms looks like a unix timestamp, not a duration: $last_duration_ms"
  ((TESTS_FAILED+=1))
else
  echo -e "${GREEN}✓${NC} duration_ms is a sane millisecond duration (got: $last_duration_ms ms)"
  ((TESTS_PASSED+=1))
fi

# Test: duration_ms is non-negative (defensive check; clamped to 0 in wrapper)
if [ -n "$last_duration_ms" ] && [ "$last_duration_ms" -ge 0 ]; then
  echo -e "${GREEN}✓${NC} duration_ms is non-negative"
  ((TESTS_PASSED+=1))
else
  echo -e "${RED}✗${NC} duration_ms is negative or unparseable: $last_duration_ms"
  ((TESTS_FAILED+=1))
fi

echo ""
echo "--- IFS Regression Test ---"

# Test: IFS=$'\n\t' line is NOT present in source.
#
# Background: an earlier version of this wrapper set IFS=$'\n\t' near the top.
# That made unquoted word splitting in `for x in $space_separated_list` loops
# stop splitting on spaces — which broke validate_path's `for base in $allowed_bases`
# (and similarly is_vetted_package / is_allowed_service), causing the wrapper to
# treat the entire space-joined list as a single literal "base" and reject all
# legitimate paths with "not under allowed base". Live-patched on stolution
# 2026-05-08; we keep an explicit guard against re-introduction here.
if grep -nE "^IFS=\\\$'" "$(dirname "$0")/../bin/orchestrator-exec" >/dev/null 2>&1; then
  echo -e "${RED}✗${NC} IFS=\$'...' line re-introduced — will break space-separated list iteration"
  ((TESTS_FAILED+=1))
else
  echo -e "${GREEN}✓${NC} No IFS=\$'...' override in wrapper source"
  ((TESTS_PASSED+=1))
fi

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
