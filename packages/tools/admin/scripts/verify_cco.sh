#!/bin/bash
# Verify CCO Integration

echo "CCO Integration Status:"
echo "======================"

if [ -f "/Users/MAC/Documents/projects/admin/cco_config.json" ]; then
    echo "✅ CCO config: Found"
    echo "📊 Stats:"
    python3 -c "
import json
with open('/Users/MAC/Documents/projects/admin/cco_config.json') as f:
    config = json.load(f)
    print(f'  - Total configs: {config[\"configurations\"][\"total\"]}')
    print(f'  - Speedup: {config[\"performance\"][\"speedup\"]}')
    print(f'  - Success rate: {config[\"performance\"][\"success_rate\"]}')
"
else
    echo "❌ CCO config: Not found"
fi

echo ""
echo "Directories:"
for dir in hooks auto-commands decisions monitors context quality-gates; do
    if [ -d "/Users/MAC/Documents/projects/admin/$dir" ]; then
        COUNT=$(ls -1 "/Users/MAC/Documents/projects/admin/$dir" | wc -l)
        echo "  ✅ $dir: $COUNT files"
    fi
done
