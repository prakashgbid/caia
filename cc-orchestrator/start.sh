#!/bin/bash

# CC Orchestrator Startup Script

echo "🚀 Starting CC Orchestrator System..."

# Navigate to orchestrator directory
cd /Users/MAC/Documents/projects/caia/cc-orchestrator

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Create required directories
mkdir -p data logs

# Check if already running
if curl -s http://localhost:8885/status > /dev/null 2>&1; then
    echo "✅ CC Orchestrator is already running"
    exit 0
fi

# Start the daemon
echo "🔧 Starting daemon..."
node src/daemon.js start

# Wait for startup
sleep 3

# Check status
if curl -s http://localhost:8885/status > /dev/null 2>&1; then
    echo "✅ CC Orchestrator is running successfully!"
    echo "📊 API available at: http://localhost:8885"
    echo "📝 Logs at: /Users/MAC/Documents/projects/caia/cc-orchestrator/logs/daemon.log"

    # Show initial stats
    echo ""
    echo "📈 Initial Status:"
    curl -s http://localhost:8885/status | jq '.'
else
    echo "❌ Failed to start CC Orchestrator"
    echo "Check logs at: /Users/MAC/Documents/projects/caia/cc-orchestrator/logs/daemon.log"
    exit 1
fi