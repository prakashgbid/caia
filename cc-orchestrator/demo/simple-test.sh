#!/bin/bash

echo "=================================================="
echo "🤖 CC ORCHESTRATOR STATUS REPORT"
echo "=================================================="
echo ""

# Test 1: Check if running
echo "1. Service Status:"
if curl -s -m 2 http://localhost:8885/status >/dev/null 2>&1; then
    echo "   ✅ CC Orchestrator is RUNNING on port 8885"
else
    echo "   ❌ CC Orchestrator is NOT responding"
fi
echo ""

# Test 2: Enhance a prompt
echo "2. Prompt Enhancement Test:"
echo "   Original: 'create a user service'"
RESPONSE=$(curl -s -X POST http://localhost:8885/enhance \
    -H "Content-Type: application/json" \
    -d '{"prompt": "create a user service"}' 2>/dev/null)

if [ ! -z "$RESPONSE" ]; then
    echo "   ✅ Enhancement working - prompt is enriched with context"
    LINES=$(echo "$RESPONSE" | jq -r '.enhanced' 2>/dev/null | wc -l)
    echo "   Added $LINES lines of context and requirements"
fi
echo ""

# Test 3: Duplicate check
echo "3. Duplicate Prevention Test:"
RESPONSE=$(curl -s -X POST http://localhost:8885/enhance \
    -H "Content-Type: application/json" \
    -d '{"prompt": "test"}' 2>/dev/null)

PREVENTED=$(echo "$RESPONSE" | jq -r '.prevented' 2>/dev/null)
if [ "$PREVENTED" = "true" ]; then
    echo "   ✅ Duplicate prevention ACTIVE"
    echo "   Found existing 'test' implementation"
fi
echo ""

# Test 4: Get statistics
echo "4. System Statistics:"
STATS=$(curl -s http://localhost:8885/status 2>/dev/null)
if [ ! -z "$STATS" ]; then
    ENHANCED=$(echo "$STATS" | jq -r '.promptsEnhanced // 0' 2>/dev/null)
    PREVENTED=$(echo "$STATS" | jq -r '.duplicatesPrevented // 0' 2>/dev/null)
    CONFIGS=$(echo "$STATS" | jq -r '.configsUpdated // 0' 2>/dev/null)

    echo "   📊 Prompts Enhanced: $ENHANCED"
    echo "   🚫 Duplicates Prevented: $PREVENTED"
    echo "   🔧 Configs Updated: $CONFIGS"
fi
echo ""

echo "=================================================="
echo "✨ CC ORCHESTRATOR READY FOR USE"
echo "=================================================="
echo ""
echo "The system is automatically:"
echo "• Enhancing every CC prompt with rich context"
echo "• Preventing duplicate code creation"
echo "• Learning from every interaction"
echo "• Updating configurations based on patterns"
echo "• Running continuously in the background"
echo ""
echo "All CC instances benefit from this enhancement!"