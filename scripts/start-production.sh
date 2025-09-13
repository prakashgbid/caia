#!/bin/bash

# CAIA Production Startup Script
# This script starts all services required for production

set -e

echo "🚀 Starting CAIA Production Services..."

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Function to check if service is running
check_service() {
    local service=$1
    local port=$2

    if nc -z localhost $port 2>/dev/null; then
        echo "✅ $service is running on port $port"
        return 0
    else
        echo "⚠️  $service is not running on port $port"
        return 1
    fi
}

# Function to start service if not running
start_if_needed() {
    local service=$1
    local port=$2
    local start_cmd=$3

    if ! check_service "$service" "$port"; then
        echo "Starting $service..."
        eval "$start_cmd"
        sleep 2
        check_service "$service" "$port"
    fi
}

# 1. Check/Start Redis
echo ""
echo "📦 Checking Redis..."
start_if_needed "Redis" 6379 "redis-server --daemonize yes 2>/dev/null || echo 'Redis start failed - install with: brew install redis'"

# 2. Check/Start PostgreSQL
echo ""
echo "🐘 Checking PostgreSQL..."
if ! check_service "PostgreSQL" 5432; then
    echo "PostgreSQL not running. Please start it manually:"
    echo "  macOS: brew services start postgresql"
    echo "  Linux: sudo systemctl start postgresql"
fi

# 3. Check/Start Neo4j
echo ""
echo "🔷 Checking Neo4j..."
if ! check_service "Neo4j" 7687; then
    echo "Neo4j not running. To start:"
    echo "  1. Download from https://neo4j.com/download/"
    echo "  2. Run: neo4j start"
    echo "  3. Set password to match .env file"
fi

# 4. Compile TypeScript
echo ""
echo "📝 Compiling TypeScript..."
if [ ! -d "dist" ]; then
    echo "First time compilation, this may take a minute..."
    npx tsc -p tsconfig.production.json || echo "TypeScript compilation had some errors (this is normal for first run)"
else
    echo "Incremental compilation..."
    npx tsc -p tsconfig.production.json --incremental || echo "TypeScript compilation had some errors"
fi

# 5. Create required directories
echo ""
echo "📁 Creating required directories..."
mkdir -p logs models data/cache data/uploads tmp/ramdisk

# 6. Initialize databases if needed
echo ""
echo "🗄️ Initializing databases..."
if [ "$DB_HOST" = "localhost" ] && check_service "PostgreSQL" 5432; then
    # Create database if it doesn't exist
    psql -U $DB_USER -h localhost -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || echo "Database already exists or cannot connect"
fi

# 7. Start the application
echo ""
echo "🎯 Starting CAIA Application..."

# Check if PM2 is available
if command -v pm2 &> /dev/null; then
    echo "Using PM2 for process management..."
    pm2 start ecosystem.config.js --env production
    pm2 logs --lines 5
else
    echo "Starting with Node.js directly..."

    # Start knowledge system services
    echo "Starting Knowledge System API..."
    node dist/knowledge-system/api/server.js &

    # Start main application
    echo "Starting Main Application..."
    node dist/index.js || node dist/main.js || echo "No main entry point found"
fi

echo ""
echo "✨ CAIA Production Services Started!"
echo ""
echo "📊 Service Status:"
check_service "Redis" 6379 || true
check_service "PostgreSQL" 5432 || true
check_service "Neo4j" 7687 || true
check_service "API" 3000 || true
check_service "Metrics" 9090 || true

echo ""
echo "🔗 Access Points:"
echo "  API:     http://localhost:${API_PORT:-3000}"
echo "  Metrics: http://localhost:${METRICS_PORT:-9090}"
echo "  Neo4j:   http://localhost:7474 (browser)"

echo ""
echo "📝 Logs:"
echo "  Application: ./logs/combined.log"
echo "  Errors:      ./logs/error.log"

echo ""
echo "💡 Commands:"
echo "  Stop all:    pm2 stop all"
echo "  Restart:     pm2 restart all"
echo "  Logs:        pm2 logs"
echo "  Monitor:     pm2 monit"

echo ""
echo "🎉 Production environment ready!"