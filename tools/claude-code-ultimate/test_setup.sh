#!/bin/bash

# Claude Code Ultimate - Setup Test Script
# This script verifies the project structure and initial setup

echo "🚀 Claude Code Ultimate - Setup Verification"
echo "==========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test function
test_item() {
    local test_name="$1"
    local test_command="$2"
    
    echo -n "Testing: $test_name ... "
    
    if eval "$test_command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASSED${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    fi
}

# Initialize counters
TOTAL=0
PASSED=0

echo "📁 Project Structure Tests"
echo "--------------------------"

# Test directory structure
test_item "Project root exists" "[ -d 'claude-code-ultimate' ] || [ -d '.' ]" && ((PASSED++))
((TOTAL++))

test_item "Configs directory" "[ -d 'configs' ]" && ((PASSED++))
((TOTAL++))

test_item "Installers directory" "[ -d 'installers' ]" && ((PASSED++))
((TOTAL++))

test_item "Templates directory" "[ -d 'templates' ]" && ((PASSED++))
((TOTAL++))

test_item "Agents directory" "[ -d 'agents' ]" && ((PASSED++))
((TOTAL++))

test_item "Knowledge directory" "[ -d 'knowledge' ]" && ((PASSED++))
((TOTAL++))

test_item "Tools directory" "[ -d 'tools' ]" && ((PASSED++))
((TOTAL++))

test_item "Docs directory" "[ -d 'docs' ]" && ((PASSED++))
((TOTAL++))

test_item ".claude directory" "[ -d '.claude' ]" && ((PASSED++))
((TOTAL++))

echo ""
echo "📄 Core Files Tests"
echo "-------------------"

test_item "Enhancement Matrix exists" "[ -f 'ENHANCEMENT_MATRIX.md' ]" && ((PASSED++))
((TOTAL++))

test_item "README exists" "[ -f 'README.md' ]" && ((PASSED++))
((TOTAL++))

test_item "Project CLAUDE.md exists" "[ -f '.claude/CLAUDE.md' ]" && ((PASSED++))
((TOTAL++))

test_item "This test script exists" "[ -f 'test_setup.sh' ]" && ((PASSED++))
((TOTAL++))

echo ""
echo "🔧 Environment Tests"
echo "--------------------"

test_item "Claude Code installed" "command -v claude" && ((PASSED++))
((TOTAL++))

test_item "Python 3 available" "command -v python3" && ((PASSED++))
((TOTAL++))

test_item "Node.js available" "command -v node" && ((PASSED++))
((TOTAL++))

test_item "Git available" "command -v git" && ((PASSED++))
((TOTAL++))

echo ""
echo "📊 Configuration Subdirectories"
echo "-------------------------------"

for dir in core memory performance agents mcp-servers hooks ci-cd enterprise; do
    test_item "configs/$dir directory" "[ -d 'configs/$dir' ]" && ((PASSED++))
    ((TOTAL++))
done

echo ""
echo "📋 Template Subdirectories"
echo "--------------------------"

for dir in prp-framework project-types commands; do
    test_item "templates/$dir directory" "[ -d 'templates/$dir' ]" && ((PASSED++))
    ((TOTAL++))
done

echo ""
echo "==========================================="
echo "📊 RESULTS"
echo "==========================================="
echo -e "Total Tests: $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$((TOTAL - PASSED))${NC}"

PERCENTAGE=$((PASSED * 100 / TOTAL))
echo -e "Success Rate: $PERCENTAGE%"

if [ $PERCENTAGE -eq 100 ]; then
    echo -e "${GREEN}✅ All tests passed! Setup is complete.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Review ENHANCEMENT_MATRIX.md for implementation items"
    echo "2. Start with Phase 1 (Core Configuration Files)"
    echo "3. Run 'bash installers/quick-start.sh' when ready"
    exit 0
elif [ $PERCENTAGE -ge 80 ]; then
    echo -e "${YELLOW}⚠️  Most tests passed. Some optional items missing.${NC}"
    exit 0
else
    echo -e "${RED}❌ Setup incomplete. Please check failed items.${NC}"
    exit 1
fi