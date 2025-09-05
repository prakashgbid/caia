#!/bin/bash

# Start all hierarchical agent services
echo "🚀 Starting Hierarchical Agent System Services"
echo "=============================================="

CAIA_ROOT="/Users/MAC/Documents/projects/caia"

# Start intelligence hub (Stream 3)
echo "Starting Intelligence Hub..."
cd "$CAIA_ROOT/admin/scripts"
python3 stream3_intelligence_hub.py --daemon &
INTELLIGENCE_PID=$!

# Start monitoring service (Stream 5)
echo "Starting Monitoring Service..."
cd "$CAIA_ROOT/packages/orchestration"
node dist/monitoring/metrics/MetricsCollector.js --daemon &
MONITORING_PID=$!

# Start cache service (Stream 5)
echo "Starting Cache Service..."
node dist/cache/CacheService.js --daemon &
CACHE_PID=$!

# Create PID file for service management
cat > "$CAIA_ROOT/var/hierarchical-services.pid" << PIDEOF
INTELLIGENCE_PID=$INTELLIGENCE_PID
MONITORING_PID=$MONITORING_PID
CACHE_PID=$CACHE_PID
PIDEOF

echo "✅ All services started successfully!"
echo "PIDs saved to: $CAIA_ROOT/var/hierarchical-services.pid"
