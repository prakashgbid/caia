#!/bin/bash

echo "Testing CCO Integration..."
echo ""

# Test 1: Auto-detection
echo "Test 1: Auto-detection"
python3 cco_auto_detector.py "implement all 82 configurations"
echo ""

# Test 2: Check CCO availability
echo "Test 2: CCO Availability"
if [ -f "/Users/MAC/Documents/projects/caia/packages/utils/cc-orchestrator/src/index.ts" ]; then
    echo "✅ CCO is available"
else
    echo "❌ CCO not found"
fi
echo ""

# Test 3: Configuration files
echo "Test 3: Configuration Files"
for file in cco_awareness.json ../CLAUDE_CCO_INSTRUCTIONS.md; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
    fi
done
