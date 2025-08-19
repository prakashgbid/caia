# CAIA Admin System

## 🚀 Quick Start: CC Admin Commands

Type `%` in Claude Code to see all available admin commands!

### Most Used Commands
- `%s` - Quick project status
- `%c` - CAIA status
- `%d` - Recent decisions
- `%l` - Log a decision
- `%p` - Log progress
- `%qa` - Quality check

📚 **[Full Command Documentation](docs/CC_ADMIN_COMMANDS.md)** | 🎓 **[Interactive Tutorial](docs/CC_ADMIN_TUTORIAL.md)**

## Overview

This admin system provides comprehensive context management and decision tracking for all projects in the `/Users/MAC/Documents/projects` folder. It's designed to maintain continuity across Claude sessions and provide a persistent knowledge base for managing complex, multi-project development efforts.

## Purpose

- **Overcome Context Limitations**: Maintain project state across Claude sessions
- **Track Decisions**: Log all architectural and implementation decisions
- **Monitor Progress**: Track progress on tasks and features
- **Capture Context**: Hourly snapshots of project state and changes
- **Enable Continuity**: Allow new sessions to quickly understand project history

## Directory Structure

```
admin/
├── context/          # Timestamped context snapshots (hourly)
├── decisions/        # Decision logs, discussions, and progress
├── logs/            # System logs and daemon output
├── scripts/         # Management and automation scripts
└── README.md        # This file
```

## Core Components

### 1. Context Capture System (`capture_context.py`)

Performs deep scanning of all projects to capture:
- Git commits and changes
- File modifications
- TODO/FIXME items in code
- Project structure and technologies
- Dependencies and key files

**Features:**
- Hourly automatic capture via daemon mode
- Comparison with previous context to highlight changes
- Project-specific summaries
- Technology detection

### 2. Decision Logger (`log_decision.py`)

Records important decisions, discussions, and progress:
- **Decisions**: Architectural choices, implementation strategies
- **Progress**: Task completion, milestones
- **Discussions**: Key points, action items

**Usage in Claude:**
```bash
# After making any significant decision
python3 /Users/MAC/Documents/projects/admin/scripts/log_decision.py \
  --type decision \
  --title "Title here" \
  --description "Details here" \
  --project "project-name"
```

### 3. Context Query System (`query_context.py`)

Query and analyze captured context:
- Latest context snapshot
- Project-specific summaries
- Decision history
- Progress reports
- Executive summaries

**Commands:**
```bash
# Get executive summary
python3 admin/scripts/query_context.py --command summary

# Get project details
python3 admin/scripts/query_context.py --command project --project caia

# View recent decisions
python3 admin/scripts/query_context.py --command decisions --days 7
```

## Automation

### Starting the Context Daemon

The daemon captures context every hour automatically:

```bash
# Start daemon
./admin/scripts/start_context_daemon.sh

# Stop daemon
./admin/scripts/stop_context_daemon.sh

# Check status
ps aux | grep capture_context.py
```

### Manual Context Capture

For immediate context capture:

```bash
python3 admin/scripts/capture_context.py --hours 24
```

## Integration with Claude

The `CLAUDE.md` file in the projects root instructs Claude to:
1. Automatically log decisions after significant work
2. Query context before starting major tasks
3. Update progress on long-running tasks
4. Reference historical decisions

## Best Practices

### For Claude/AI Assistants:

1. **Start of Session**: Query context summary to understand current state
2. **Before Major Work**: Check project-specific context and recent decisions
3. **After Decisions**: Log the decision with rationale
4. **Task Completion**: Update progress logs
5. **End of Session**: Ensure all significant decisions are logged

### For Developers:

1. **Review Context**: Check daily summaries for project overview
2. **Track Decisions**: Use decision logs for documentation
3. **Monitor Progress**: Use progress reports for status updates
4. **Maintain Daemon**: Ensure hourly capture is running

## File Formats

### Context Files
- Location: `admin/context/context_YYYYMMDD_HHMMSS.json`
- Contains: Complete project snapshot with git info, TODOs, changes

### Decision Files
- Daily aggregation: `admin/decisions/decisions_YYYYMMDD.json`
- Individual critical: `admin/decisions/decision_YYYYMMDD_HHMMSS.json`

### Progress Files
- Location: `admin/decisions/progress_YYYYMMDD.json`
- Contains: Task progress updates with completion percentages

## Querying Examples

### Get Project Status
```bash
# Full project summary
python3 admin/scripts/query_context.py --command project --project caia

# JSON format for processing
python3 admin/scripts/query_context.py --command project --project caia --format json
```

### Track Progress
```bash
# All projects progress
python3 admin/scripts/query_context.py --command progress

# Specific project progress
python3 admin/scripts/query_context.py --command progress --project roulette-community
```

### Decision History
```bash
# Last 30 days of decisions
python3 admin/scripts/query_context.py --command decisions --days 30

# Project-specific decisions
python3 admin/scripts/query_context.py --command decisions --project paraforge --days 7
```

## Maintenance

### Log Rotation
Context and decision files are organized by date. Consider archiving files older than 30 days:

```bash
# Archive old context files
find admin/context -name "*.json" -mtime +30 -exec mv {} admin/context/archive/ \;
```

### Disk Usage
Monitor disk usage as context files can grow:

```bash
du -sh admin/context/
du -sh admin/decisions/
```

## Troubleshooting

### Daemon Not Starting
- Check if already running: `ps aux | grep capture_context.py`
- Check logs: `tail -f admin/logs/context_daemon.log`
- Ensure Python 3 is available: `which python3`

### Context Capture Failing
- Check permissions on project directories
- Verify git is installed for git operations
- Check for syntax errors in Python scripts

### Decision Logging Failing
- Ensure decisions directory exists
- Check write permissions
- Verify JSON format in existing files

## Future Enhancements

Planned improvements:
1. **Web Dashboard**: Visual interface for context browsing
2. **AI Summaries**: GPT-powered daily summaries
3. **Metrics Tracking**: Code quality and velocity metrics
4. **Integration APIs**: REST API for external tools
5. **Notification System**: Alerts for critical decisions
6. **Context Search**: Full-text search across all context
7. **Automated Reporting**: Weekly/monthly reports

## Security Notes

- Decision logs may contain sensitive information
- Ensure proper access controls on admin directory
- Consider encrypting archived context files
- Avoid logging credentials or secrets

## Support

For issues or improvements:
1. Check the logs in `admin/logs/`
2. Review recent context captures
3. Ensure all scripts have execution permissions
4. Verify Python dependencies are installed

---

*This admin system ensures comprehensive project management and continuity across development sessions.*

*Created: 2025-08-16*
*Version: 1.0.0*