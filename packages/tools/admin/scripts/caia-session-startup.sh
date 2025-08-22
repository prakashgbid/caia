
# CCO Integration Check
echo ""
echo -e "${YELLOW}⚡ CC-Orchestrator Status:${NC}"
if [ -f "$CCO_PATH/src/index.ts" ]; then
    echo -e "   ✅ CCO Available for parallel execution"
    echo -e "   💡 Auto-detects tasks needing parallelization"
    echo -e "   🚀 Use for: configs, fixes, updates, tests"
    export CCO_ENABLED=true
    export CCO_AUTO_DETECT=true
else
    echo -e "   ❌ CCO not found"
fi

# CCO Integration Check
echo ""
echo -e "${YELLOW}⚡ CC-Orchestrator Status:${NC}"
if [ -f "$CCO_PATH/src/index.ts" ]; then
    echo -e "   ✅ CCO Available for parallel execution"
    echo -e "   💡 Auto-detects tasks needing parallelization"
    echo -e "   🚀 Use for: configs, fixes, updates, tests"
    export CCO_ENABLED=true
    export CCO_AUTO_DETECT=true
else
    echo -e "   ❌ CCO not found"
fi
