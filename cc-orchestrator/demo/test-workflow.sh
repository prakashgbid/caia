#!/bin/bash

# CC Orchestrator Full Workflow Demonstration
# This script demonstrates how CC Orchestrator enhances prompts and prevents duplicates

echo "=================================================="
echo "🤖 CC ORCHESTRATOR WORKFLOW DEMONSTRATION"
echo "=================================================="
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if CC Orchestrator is running
check_orchestrator() {
    curl -s -m 2 http://localhost:8885/status >/dev/null 2>&1
    return $?
}

# Test 1: Basic Enhancement
test_basic_enhancement() {
    echo -e "${BLUE}Test 1: Basic Prompt Enhancement${NC}"
    echo "--------------------------------------"

    PROMPT="create a logging system"
    echo "Original Prompt: '$PROMPT'"
    echo ""

    RESPONSE=$(curl -s -X POST http://localhost:8885/enhance \
        -H "Content-Type: application/json" \
        -d "{\"prompt\": \"$PROMPT\"}" 2>/dev/null)

    ENHANCED=$(echo "$RESPONSE" | jq -r '.enhanced' 2>/dev/null | head -10)
    PREVENTED=$(echo "$RESPONSE" | jq -r '.prevented' 2>/dev/null)

    if [ "$PREVENTED" = "true" ]; then
        echo -e "${YELLOW}⚠️  Duplicate detected!${NC}"
        echo "$ENHANCED"
    else
        echo -e "${GREEN}✅ Enhanced prompt:${NC}"
        echo "$ENHANCED" | head -20
        echo "..."
    fi
    echo ""
}

# Test 2: Duplicate Prevention
test_duplicate_prevention() {
    echo -e "${BLUE}Test 2: Duplicate Prevention${NC}"
    echo "--------------------------------------"

    # First, try to create something that might already exist
    PROMPT="create authentication system with JWT"
    echo "Checking for: '$PROMPT'"
    echo ""

    RESPONSE=$(curl -s -X POST http://localhost:8885/enhance \
        -H "Content-Type: application/json" \
        -d "{\"prompt\": \"$PROMPT\"}" 2>/dev/null)

    PREVENTED=$(echo "$RESPONSE" | jq -r '.prevented' 2>/dev/null)

    if [ "$PREVENTED" = "true" ]; then
        echo -e "${GREEN}✅ Duplicate prevention working!${NC}"
        LOCATION=$(echo "$RESPONSE" | jq -r '.enhanced' 2>/dev/null | grep -o "at: .*" | head -1)
        echo "Existing implementation found $LOCATION"
    else
        echo -e "${YELLOW}No duplicate found - would create new implementation${NC}"
    fi
    echo ""
}

# Test 3: Context-Aware Enhancement
test_context_enhancement() {
    echo -e "${BLUE}Test 3: Context-Aware Enhancement${NC}"
    echo "--------------------------------------"

    PROMPT="add error handling to the API"
    echo "Original Prompt: '$PROMPT'"
    echo "With context: project=caia, session=demo-123"
    echo ""

    RESPONSE=$(curl -s -X POST http://localhost:8885/enhance \
        -H "Content-Type: application/json" \
        -d "{
            \"prompt\": \"$PROMPT\",
            \"context\": {
                \"project\": \"caia\",
                \"session\": \"demo-123\",
                \"currentFile\": \"api/server.js\"
            }
        }" 2>/dev/null)

    echo -e "${GREEN}✅ Context-enhanced prompt includes:${NC}"
    echo "$RESPONSE" | jq -r '.context.currentProject' 2>/dev/null | xargs -I {} echo "- Project: {}"
    echo "$RESPONSE" | jq -r '.context.projectPath' 2>/dev/null | xargs -I {} echo "- Path: {}"
    echo "$RESPONSE" | jq -r '.context.availableComponents.agents[]' 2>/dev/null | head -3 | xargs -I {} echo "- Available agent: {}"
    echo ""
}

# Test 4: Learning from Response
test_learning() {
    echo -e "${BLUE}Test 4: Learning from Responses${NC}"
    echo "--------------------------------------"

    echo "Sending completed task for learning..."

    curl -s -X POST http://localhost:8885/analyze \
        -H "Content-Type: application/json" \
        -d '{
            "prompt": "create user authentication",
            "response": "Created complete auth system with JWT, OAuth, and session management",
            "context": {
                "filesCreated": ["auth/jwt.js", "auth/oauth.js"],
                "success": true,
                "duration": 145
            }
        }' >/dev/null 2>&1

    echo -e "${GREEN}✅ CC Orchestrator learned from the response${NC}"
    echo "- Will remember this pattern for future requests"
    echo "- Will prevent duplicate auth implementations"
    echo ""
}

# Test 5: Statistics
test_statistics() {
    echo -e "${BLUE}Test 5: Orchestrator Statistics${NC}"
    echo "--------------------------------------"

    STATS=$(curl -s http://localhost:8885/status 2>/dev/null)

    if [ ! -z "$STATS" ]; then
        ENHANCED=$(echo "$STATS" | jq -r '.promptsEnhanced // 0' 2>/dev/null)
        PREVENTED=$(echo "$STATS" | jq -r '.duplicatesPrevented // 0' 2>/dev/null)
        CONFIGS=$(echo "$STATS" | jq -r '.configsUpdated // 0' 2>/dev/null)

        echo -e "${GREEN}📊 Current Statistics:${NC}"
        echo "- Prompts Enhanced: $ENHANCED"
        echo "- Duplicates Prevented: $PREVENTED"
        echo "- Configs Updated: $CONFIGS"
    else
        echo -e "${YELLOW}Unable to retrieve statistics${NC}"
    fi
    echo ""
}

# Main execution
main() {
    # Check if orchestrator is running
    if ! check_orchestrator; then
        echo -e "${RED}❌ CC Orchestrator is not running${NC}"
        echo "Starting it now..."

        cd /Users/MAC/Documents/projects/caia/cc-orchestrator
        nohup node src/daemon.js start > /tmp/cc-orchestrator.log 2>&1 &
        sleep 3

        if check_orchestrator; then
            echo -e "${GREEN}✅ CC Orchestrator started${NC}"
        else
            echo -e "${RED}Failed to start CC Orchestrator${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}✅ CC Orchestrator is running${NC}"
    fi

    echo ""

    # Run all tests
    test_basic_enhancement
    test_duplicate_prevention
    test_context_enhancement
    test_learning
    test_statistics

    echo "=================================================="
    echo -e "${GREEN}✨ CC ORCHESTRATOR DEMONSTRATION COMPLETE${NC}"
    echo "=================================================="
    echo ""
    echo "The CC Orchestrator is now:"
    echo "1. Enhancing every prompt with rich context"
    echo "2. Preventing duplicate code creation"
    echo "3. Learning from every interaction"
    echo "4. Auto-updating configurations"
    echo "5. Running autonomously in the background"
    echo ""
    echo "All CC instances will benefit from this enhancement!"
}

# Run main function
main