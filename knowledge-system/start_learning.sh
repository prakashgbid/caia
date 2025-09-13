#!/bin/bash

# CAIA Knowledge System - Phase 3 Learning System Startup Script
# Starts all learning components with proper dependencies

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LEARNING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$LEARNING_DIR/learning/logs"
DATA_DIR="$LEARNING_DIR/data"
MODELS_DIR="$LEARNING_DIR/learning/models"
PIDS_FILE="/tmp/caia_learning_pids.txt"

# Ensure directories exist
mkdir -p "$LOGS_DIR" "$DATA_DIR" "$MODELS_DIR"

echo -e "${BLUE}🧠 CAIA Phase 3 Learning System Startup${NC}"
echo "========================================"

# Function to log with timestamp
log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR: $1${NC}"
}

# Function to check if process is running
is_running() {
    local pid=$1
    kill -0 "$pid" 2>/dev/null
}

# Function to start component
start_component() {
    local name="$1"
    local command="$2"
    local log_file="$3"
    
    log "Starting $name..."
    
    # Start the component in background
    cd "$LEARNING_DIR"
    eval "$command" > "$log_file" 2>&1 &
    local pid=$!
    
    # Save PID
    echo "$name:$pid" >> "$PIDS_FILE"
    
    # Wait a moment and check if it started successfully
    sleep 2
    if is_running "$pid"; then
        log "✅ $name started (PID: $pid)"
        return 0
    else
        error "❌ $name failed to start"
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        error "Python3 is required but not installed"
        exit 1
    fi
    
    # Check required Python packages
    local required_packages=("torch" "transformers" "sqlite3" "numpy" "sklearn" "asyncio" "httpx")
    for package in "${required_packages[@]}"; do
        if ! python3 -c "import $package" 2>/dev/null; then
            warn "Python package '$package' not found - installing..."
            pip3 install "$package" || warn "Failed to install $package"
        fi
    done
    
    # Check Ollama
    if ! command -v ollama &> /dev/null; then
        warn "Ollama not found - some features may be limited"
    fi
    
    # Check database
    if [ ! -f "$DATA_DIR/learning_interactions.db" ]; then
        log "Initializing learning database..."
        python3 -c "
import sqlite3
import os
os.makedirs('$DATA_DIR', exist_ok=True)
conn = sqlite3.connect('$DATA_DIR/learning_interactions.db')
conn.close()
print('Database initialized')
"
    fi
    
    log "✅ Prerequisites check complete"
}

# Function to start all learning components
start_learning_components() {
    log "Starting learning components..."
    
    # Clear old PIDs file
    > "$PIDS_FILE"
    
    # 1. Start Interaction Logger (foundational)
    start_component \
        "Interaction Logger" \
        "python3 learning/continuous/interaction_logger.py" \
        "$LOGS_DIR/interaction_logger_startup.log"
    
    # 2. Start User Profile Builder
    start_component \
        "User Profile Builder" \
        "python3 learning/personalization/user_profile.py" \
        "$LOGS_DIR/user_profile_startup.log"
    
    # 3. Start Uncertainty Sampler
    start_component \
        "Uncertainty Sampler" \
        "python3 learning/active/uncertainty_sampler.py" \
        "$LOGS_DIR/uncertainty_sampler_startup.log"
    
    # 4. Start Fine Tuner (requires more resources)
    if [ "${ENABLE_FINE_TUNING:-true}" = "true" ]; then
        start_component \
            "Fine Tuner" \
            "python3 learning/training/fine_tuner.py" \
            "$LOGS_DIR/fine_tuner_startup.log"
    else
        warn "Fine tuning disabled via environment variable"
    fi
    
    # 5. Start RLHF Trainer
    if [ "${ENABLE_RLHF:-true}" = "true" ]; then
        start_component \
            "RLHF Trainer" \
            "python3 learning/feedback/rlhf_trainer.py" \
            "$LOGS_DIR/rlhf_trainer_startup.log"
    else
        warn "RLHF training disabled via environment variable"
    fi
    
    # 6. Start Learning Orchestrator (coordinates everything)
    start_component \
        "Learning Orchestrator" \
        "python3 learning/integration/learning_orchestrator.py" \
        "$LOGS_DIR/learning_orchestrator_startup.log"
    
    log "✅ All learning components started"
}

# Function to verify components are working
verify_components() {
    log "Verifying component health..."
    
    local failed=0
    
    # Check each component
    while IFS=':' read -r name pid; do
        if [ -n "$name" ] && [ -n "$pid" ]; then
            if is_running "$pid"; then
                log "✅ $name (PID: $pid) - Running"
            else
                error "❌ $name (PID: $pid) - Not running"
                ((failed++))
            fi
        fi
    done < "$PIDS_FILE"
    
    if [ $failed -eq 0 ]; then
        log "✅ All components verified"
        return 0
    else
        error "$failed component(s) failed verification"
        return 1
    fi
}

# Function to show status
show_status() {
    echo
    log "Learning System Status:"
    echo "======================"
    
    if [ -f "$PIDS_FILE" ]; then
        while IFS=':' read -r name pid; do
            if [ -n "$name" ] && [ -n "$pid" ]; then
                if is_running "$pid"; then
                    echo -e "  ${GREEN}●${NC} $name (PID: $pid)"
                else
                    echo -e "  ${RED}●${NC} $name (PID: $pid) - STOPPED"
                fi
            fi
        done < "$PIDS_FILE"
    else
        warn "No components running"
    fi
    
    echo
    log "Log files location: $LOGS_DIR"
    log "Data directory: $DATA_DIR"
    log "Models directory: $MODELS_DIR"
}

# Function to stop all components
stop_all() {
    log "Stopping all learning components..."
    
    if [ -f "$PIDS_FILE" ]; then
        while IFS=':' read -r name pid; do
            if [ -n "$name" ] && [ -n "$pid" ] && is_running "$pid"; then
                log "Stopping $name (PID: $pid)..."
                kill "$pid" 2>/dev/null || true
                
                # Wait for graceful shutdown
                local count=0
                while is_running "$pid" && [ $count -lt 10 ]; do
                    sleep 1
                    ((count++))
                done
                
                # Force kill if still running
                if is_running "$pid"; then
                    warn "Force killing $name (PID: $pid)"
                    kill -9 "$pid" 2>/dev/null || true
                fi
            fi
        done < "$PIDS_FILE"
        
        rm -f "$PIDS_FILE"
        log "✅ All components stopped"
    else
        warn "No PIDs file found"
    fi
}

# Function to show logs
show_logs() {
    local component="${1:-all}"
    
    if [ "$component" = "all" ]; then
        log "Showing all component logs (press Ctrl+C to stop):"
        tail -f "$LOGS_DIR"/*.log 2>/dev/null || warn "No log files found"
    else
        local log_file="$LOGS_DIR/${component}_startup.log"
        if [ -f "$log_file" ]; then
            log "Showing logs for $component:"
            tail -f "$log_file"
        else
            error "Log file not found: $log_file"
        fi
    fi
}

# Function to test learning system
test_learning_system() {
    log "Testing learning system..."
    
    cd "$LEARNING_DIR"
    python3 -c "
import sys
import asyncio
sys.path.append('learning')

async def test_system():
    try:
        # Test interaction logging
        from continuous.interaction_logger import InteractionLogger
        logger = InteractionLogger()
        interaction_id = logger.log_interaction(
            'Test user input',
            'Test AI response',
            'Test context'
        )
        print(f'✅ Interaction logged: {interaction_id}')
        
        # Test user profiling
        from personalization.user_profile import UserProfileBuilder
        profile_builder = UserProfileBuilder()
        profile = profile_builder.build_user_profile('test_user')
        print(f'✅ User profile built: {profile[\"user_id\"]}')
        
        # Test uncertainty sampling
        from active.uncertainty_sampler import UncertaintySampler
        sampler = UncertaintySampler()
        results = await sampler.active_learning_cycle()
        print(f'✅ Active learning cycle: {results[\"num_uncertain_interactions\"]} uncertain interactions')
        
        print('✅ All tests passed!')
        return True
        
    except Exception as e:
        print(f'❌ Test failed: {e}')
        return False

# Run tests
success = asyncio.run(test_system())
sys.exit(0 if success else 1)
" && log "✅ Learning system test passed" || error "❌ Learning system test failed"
}

# Main script logic
case "${1:-start}" in
    "start")
        log "Starting CAIA Learning System..."
        check_prerequisites
        start_learning_components
        verify_components
        show_status
        echo
        log "🎉 CAIA Learning System started successfully!"
        log "Use '$0 status' to check component status"
        log "Use '$0 logs' to view all logs"
        log "Use '$0 stop' to stop all components"
        ;;
    
    "stop")
        stop_all
        ;;
    
    "restart")
        stop_all
        sleep 2
        "$0" start
        ;;
    
    "status")
        show_status
        ;;
    
    "logs")
        show_logs "${2:-all}"
        ;;
    
    "test")
        test_learning_system
        ;;
    
    "health")
        log "Performing health check..."
        verify_components
        test_learning_system
        ;;
    
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|test|health}"
        echo
        echo "Commands:"
        echo "  start   - Start all learning components"
        echo "  stop    - Stop all learning components"
        echo "  restart - Restart all learning components"
        echo "  status  - Show component status"
        echo "  logs    - Show component logs (specify component name or 'all')"
        echo "  test    - Test learning system functionality"
        echo "  health  - Perform comprehensive health check"
        echo
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 logs orchestrator"
        echo "  $0 health"
        exit 1
        ;;
esac