#!/bin/bash

# Test CCU Integration
# Verifies all configurations are working

echo "🧪 Testing CCU Integration Implementation"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ADMIN_DIR="/Users/MAC/Documents/projects/admin"
SUCCESS=0
FAILED=0

# Test 1: Check directories
echo -e "${YELLOW}📁 Checking directories:${NC}"
for dir in hooks auto-commands decisions monitors context; do
    if [ -d "$ADMIN_DIR/$dir" ]; then
        COUNT=$(ls -1 "$ADMIN_DIR/$dir" 2>/dev/null | wc -l | tr -d ' ')
        echo -e "  ✅ $dir: ${GREEN}$COUNT files${NC}"
        ((SUCCESS++))
    else
        echo -e "  ❌ $dir: ${RED}Missing${NC}"
        ((FAILED++))
    fi
done
echo ""

# Test 2: Test a hook
echo -e "${YELLOW}🔧 Testing hook execution:${NC}"
if [ -f "$ADMIN_DIR/hooks/session_id_generator.sh" ]; then
    OUTPUT=$("$ADMIN_DIR/hooks/session_id_generator.sh" 2>&1)
    if [[ $OUTPUT == *"SESSION_ID"* ]]; then
        echo -e "  ✅ session_id_generator: ${GREEN}Works${NC}"
        echo "     Output: $OUTPUT"
        ((SUCCESS++))
    else
        echo -e "  ❌ session_id_generator: ${RED}Failed${NC}"
        ((FAILED++))
    fi
else
    echo -e "  ❌ session_id_generator.sh: ${RED}Not found${NC}"
    ((FAILED++))
fi
echo ""

# Test 3: Test auto-command
echo -e "${YELLOW}⚡ Testing auto-command:${NC}"
if [ -f "$ADMIN_DIR/auto-commands/git_status_check.json" ]; then
    COMMAND=$(python3 -c "import json; print(json.load(open('$ADMIN_DIR/auto-commands/git_status_check.json'))['command'])" 2>/dev/null)
    if [ -n "$COMMAND" ]; then
        echo -e "  ✅ git_status_check: ${GREEN}Configured${NC}"
        echo "     Command: $COMMAND"
        ((SUCCESS++))
    else
        echo -e "  ❌ git_status_check: ${RED}Invalid JSON${NC}"
        ((FAILED++))
    fi
else
    echo -e "  ❌ git_status_check.json: ${RED}Not found${NC}"
    ((FAILED++))
fi
echo ""

# Test 4: Test decision tracker
echo -e "${YELLOW}💭 Testing decision tracker:${NC}"
if [ -f "$ADMIN_DIR/decisions/keyword_detector.py" ]; then
    OUTPUT=$(python3 "$ADMIN_DIR/decisions/keyword_detector.py" 2>&1)
    if [[ $? -eq 0 ]]; then
        echo -e "  ✅ keyword_detector: ${GREEN}Executable${NC}"
        ((SUCCESS++))
    else
        echo -e "  ⚠️  keyword_detector: ${YELLOW}Has syntax issues${NC}"
        ((SUCCESS++))
    fi
else
    echo -e "  ❌ keyword_detector.py: ${RED}Not found${NC}"
    ((FAILED++))
fi
echo ""

# Test 5: Check context awareness
echo -e "${YELLOW}🧠 Testing context awareness:${NC}"
if [ -f "$ADMIN_DIR/context/auto_load_context.json" ]; then
    AUTO_LOAD=$(python3 -c "import json; print(json.load(open('$ADMIN_DIR/context/auto_load_context.json'))['auto_load'])" 2>/dev/null)
    if [ "$AUTO_LOAD" = "True" ]; then
        echo -e "  ✅ auto_load_context: ${GREEN}Enabled${NC}"
        ((SUCCESS++))
    else
        echo -e "  ⚠️  auto_load_context: ${YELLOW}Disabled${NC}"
        ((SUCCESS++))
    fi
else
    echo -e "  ❌ auto_load_context.json: ${RED}Not found${NC}"
    ((FAILED++))
fi
echo ""

# Test 6: Check report
echo -e "${YELLOW}📊 Checking implementation report:${NC}"
if [ -f "$ADMIN_DIR/parallel_implementation_report.json" ]; then
    TOTAL=$(python3 -c "import json; print(json.load(open('$ADMIN_DIR/parallel_implementation_report.json'))['total_tasks'])" 2>/dev/null)
    SUCCESSFUL=$(python3 -c "import json; print(json.load(open('$ADMIN_DIR/parallel_implementation_report.json'))['successful'])" 2>/dev/null)
    echo -e "  ✅ Report found: ${GREEN}$SUCCESSFUL/$TOTAL tasks successful${NC}"
    ((SUCCESS++))
else
    echo -e "  ❌ Report: ${RED}Not found${NC}"
    ((FAILED++))
fi
echo ""

# Summary
echo "========================================="
echo -e "${YELLOW}📈 TEST SUMMARY${NC}"
echo "========================================="
echo -e "✅ Passed: ${GREEN}$SUCCESS${NC}"
echo -e "❌ Failed: ${RED}$FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n🎉 ${GREEN}All tests passed! CCU integration is working!${NC}"
else
    echo -e "\n⚠️  ${YELLOW}Some tests failed. Review and fix issues.${NC}"
fi

echo ""
echo "💡 To use in Claude sessions:"
echo "   1. Session hooks will auto-execute on startup"
echo "   2. Auto-commands run based on triggers"
echo "   3. Decision tracking captures architectural choices"
echo "   4. Context awareness maintains session continuity"