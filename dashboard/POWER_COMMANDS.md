# ⚡ CAIA POWER COMMANDS: Your Daily Arsenal

## 🚨 CHAMPION'S QUICK REFERENCE

Copy and paste these commands for instant CAIA power! Each command is battle-tested and ready to use.

## 🔥 DAILY STARTUP SEQUENCE

```bash
# 1. THE POWER-UP (Run this every morning)
/Users/MAC/Documents/projects/caia/knowledge-system/scripts/start_all_services.sh
sleep 30
/Users/MAC/Documents/projects/caia/tools/admin-scripts/quick_status.sh

# 2. VERIFY ALL SYSTEMS
curl -s http://localhost:5555/health && echo "✅ CKS Ready"
curl -s http://localhost:5002/health && echo "✅ Enhancement Ready"
curl -s http://localhost:5003/health && echo "✅ Learning Ready"
```

## 🧠 KNOWLEDGE POWER COMMANDS

```bash
# Search existing code patterns
curl "http://localhost:5555/search/function?query=YOUR_SEARCH_TERM"

# Check for duplicate code before writing
curl "http://localhost:5555/check/duplicate?description=YOUR_FEATURE_DESCRIPTION"

# Get architectural suggestions
curl "http://localhost:5555/api/architecture/suggest?project=YOUR_PROJECT"

# Quick context summary
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/query_context.py --command summary
```

## ⚡ CC ORCHESTRATOR COMMANDS

```bash
# Check your parallel processing power
node -e "
const CCO = require('/Users/MAC/Documents/projects/caia/utils/parallel/cc-orchestrator/src/index.ts');
const orchestrator = new CCO({ debug: true });
orchestrator.getSystemInfo().then(console.log);
"

# Create parallel development session (use in CC)
const CCOrchestrator = require('/Users/MAC/Documents/projects/caia/utils/parallel/cc-orchestrator/src/index.ts');
const orchestrator = new CCOrchestrator({
  autoCalculateInstances: true,
  debug: true
});

# Get system metrics
node -e "
const CCO = require('/Users/MAC/Documents/projects/caia/utils/parallel/cc-orchestrator/src/index.ts');
new CCO().getMetrics().then(console.log);
"
```

## 🤖 ENHANCEMENT SYSTEM COMMANDS

```bash
# Start enhanced CC session
curl -X POST "http://localhost:5002/api/session-manager/start-enhanced-session"

# Check all enhancement systems status
curl "http://localhost:5002/api/status" | jq '.'

# Activate specific enhancements
curl -X POST "http://localhost:5002/api/performance-optimizer/optimize"
curl -X POST "http://localhost:5002/api/prediction-engine/predict-next-action"
curl -X POST "http://localhost:5002/api/self-evolution/auto-optimize"

# Get current enhancements
curl "http://localhost:5002/api/integration-hub/current-enhancements"
```

## 📝 DECISION & PROGRESS COMMANDS

```bash
# Log important decisions
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/log_decision.py \
  --title "YOUR_DECISION_TITLE" \
  --description "DECISION_DESCRIPTION" \
  --project "PROJECT_NAME"

# Check recent decisions
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/query_context.py \
  --command decisions --days 7

# Track progress
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/caia_progress_tracker.py status
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/caia_progress_tracker.py report

# Log progress update
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/caia_progress_tracker.py \
  log "YOUR_PROGRESS_MESSAGE"
```

## 🔍 ANALYSIS & INSIGHT COMMANDS

```bash
# Get code insights
curl "http://localhost:5555/api/insights/code-patterns"
curl "http://localhost:5555/api/insights/architecture-evolution"

# Decision pattern analysis
curl "http://localhost:5002/api/pattern-analyzer/decisions"

# Personal recommendations
curl "http://localhost:5002/api/prediction-engine/personal-recommendations"

# Performance metrics
curl "http://localhost:5002/api/performance-optimizer/real-time-metrics"
```

## 🚀 WORKFLOW AUTOMATION COMMANDS

```bash
# Start context daemon for continuous learning
/Users/MAC/Documents/projects/caia/tools/admin-scripts/start_context_daemon.sh

# Enable continuous learning mode
curl -X POST "http://localhost:5003/api/learning/start-continuous-mode"

# Activate turbo mode (maximum parallelization)
export MAX_PARALLEL=50
export CCO_AUTO_INVOKE=true
curl -X POST "http://localhost:5002/api/integration-hub/turbo-mode"
```

## 📊 MONITORING COMMANDS

```bash
# Quick system diagnostic
chmod +x /Users/MAC/Documents/projects/caia/dashboard/quick_diagnostic.sh
/Users/MAC/Documents/projects/caia/dashboard/quick_diagnostic.sh

# Resource utilization
curl "http://localhost:5002/api/resource-controller/utilization"

# Current task queue
curl "http://localhost:5002/api/session-manager/current-tasks"

# Learning system insights
curl "http://localhost:5003/api/learning/insights"
```

## 🎯 SPECIFIC USE CASE COMMANDS

### Building a New Feature
```bash
# 1. Check existing patterns
curl "http://localhost:5555/search/function?query=FEATURE_TYPE"

# 2. Start parallel development (in CC)
const orchestrator = new CCOrchestrator({ autoCalculateInstances: true });
await orchestrator.executeParallelTasks([
  { id: 'frontend', type: 'FEATURE', input: 'React components' },
  { id: 'backend', type: 'FEATURE', input: 'API endpoints' },
  { id: 'tests', type: 'TASK', input: 'Unit tests' }
]);

# 3. Log architectural decision
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/log_decision.py \
  --title "Feature Architecture" --description "ARCHITECTURE_CHOICE"
```

### Code Review & Optimization
```bash
# 1. Get improvement suggestions
curl "http://localhost:5002/api/accuracy-validator/suggest-improvements"

# 2. Check code quality
curl "http://localhost:5555/api/quality/analyze?project=PROJECT_NAME"

# 3. Apply auto-optimizations
curl -X POST "http://localhost:5002/api/self-evolution/optimize-codebase"
```

### Planning & Strategy
```bash
# 1. Get strategic insights
curl "http://localhost:5002/api/prediction-engine/strategic-insights"

# 2. Project roadmap analysis
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/query_context.py \
  --command roadmap --project PROJECT_NAME

# 3. Risk analysis
curl "http://localhost:5002/api/prediction-engine/risk-analysis?project=PROJECT_NAME"
```

## 🔧 TROUBLESHOOTING COMMANDS

```bash
# Restart all services
killall -9 python3 node
sleep 5
/Users/MAC/Documents/projects/caia/knowledge-system/scripts/start_all_services.sh

# Check service logs
tail -f /tmp/cks.log
tail -f /tmp/enhancement.log
tail -f /tmp/learning.log

# Reset enhancement systems
curl -X POST "http://localhost:5002/api/system/reset"
curl -X POST "http://localhost:5002/api/system/reinitialize"
```

## 🏆 ONE-LINER POWER COMMANDS

```bash
# The Ultimate Status Check
curl -s http://localhost:5555/health && curl -s http://localhost:5002/health && curl -s http://localhost:5003/health && echo "🚀 All systems operational!"

# Quick Knowledge Search
alias cks='curl "http://localhost:5555/search/function?query="'

# Instant Decision Log
alias decide='python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/log_decision.py --title'

# Quick Progress Check
alias progress='python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/caia_progress_tracker.py status'

# Enhancement Status
alias enhance='curl "http://localhost:5002/api/status" | jq "."'
```

## 🎯 COPY-PASTE READY SCRIPTS

### Daily Startup Script
```bash
#!/bin/bash
echo "🚀 CAIA Power-Up Sequence"
/Users/MAC/Documents/projects/caia/knowledge-system/scripts/start_all_services.sh
sleep 30
/Users/MAC/Documents/projects/caia/tools/admin-scripts/quick_status.sh
curl -X POST "http://localhost:5002/api/session-manager/start-enhanced-session"
echo "✅ Ready for superhuman productivity!"
```

### Development Session Script
```bash
#!/bin/bash
echo "🎯 Starting enhanced development session"
curl "http://localhost:5555/search/function?query=$1"
curl -X POST "http://localhost:5002/api/performance-optimizer/optimize"
curl -X POST "http://localhost:5003/api/learning/start-continuous-mode"
echo "🚀 Enhanced development mode activated!"
```

### End-of-Day Script
```bash
#!/bin/bash
echo "📚 Capturing session knowledge"
python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/log_decision.py \
  --title "Daily Progress" --description "$1" --project "$2"
curl -X POST "http://localhost:5555/api/knowledge/update-from-session"
curl -X POST "http://localhost:5003/api/learning/process-session"
echo "✅ Session knowledge captured!"
```

## 🚨 EMERGENCY COMMANDS

```bash
# If everything breaks
killall -9 python3 node
/Users/MAC/Documents/projects/caia/knowledge-system/scripts/repair_system.sh
/Users/MAC/Documents/projects/caia/knowledge-system/scripts/start_all_services.sh

# If CC Orchestrator issues
export CCO_FALLBACK_INSTANCES=3
node -e "console.log('CC Orchestrator in safe mode')"

# If services won't start
sudo lsof -i :5555 :5002 :5003
sudo kill -9 $(lsof -t -i :5555 :5002 :5003)
```

---

## 🏆 CHAMPION'S REMINDER

**These commands are your weapons for superhuman productivity!**

- **Bookmark this page** - You'll use these daily
- **Create aliases** - Make your favorites one-letter commands
- **Combine commands** - Chain them for powerful workflows
- **Experiment** - Every interaction makes the system smarter

**Remember**: You're not just running commands - you're conducting an orchestra of AI systems that learn and evolve with every use!

**Now go forth and achieve the impossible!** 🚀✨