# Claude Code Status Line Configuration

## Overview
Real-time status line for Claude Code that displays accurate system metrics and development activity.

## Features
- **Real-time system metrics**: CPU, RAM, Load
- **Git information**: Branch, commits, modified files
- **File tracking**: Shows files currently being accessed by Claude Code
- **Parallel process monitoring**: Tracks concurrent operations
- **Battery status**: For laptops
- **Session tracking**: Duration and model info

## Installation

1. Copy the statusline script:
```bash
cp configs/statusline/statusline-command.sh ~/.claude/statusline-command.sh
chmod +x ~/.claude/statusline-command.sh
```

2. Update Claude Code settings:
```bash
# Add statusLine configuration to ~/.claude/settings.json
{
  "statusLine": {
    "command": "/Users/MAC/.claude/statusline-command.sh",
    "refreshInterval": 1000
  }
}
```

## What's Displayed

### Accurate Real-Time Data Only
- ✅ System time and date
- ✅ Model name (Opus 4.1)
- ✅ Session duration
- ✅ CPU usage (system-wide)
- ✅ RAM usage (actual from vm_stat)
- ✅ System load average
- ✅ Battery percentage (laptops)
- ✅ Git branch and status
- ✅ Modified files count
- ✅ Commits today
- ✅ Parallel processes count
- ✅ Files being accessed

### NOT Included (Would Be Fake/Mock Data)
- ❌ Token counts (not accessible)
- ❌ API costs (cannot calculate)
- ❌ Meeting times (no calendar integration)
- ❌ Sprint progress (no JIRA in statusline)
- ❌ Temperature sensors (unreliable on Mac)
- ❌ GPU stats (not consistently available)

## Example Output
```
08/23 14:30:15 | Opus 4.1 | 01:23 | CPU:15% | RAM:8.2GB | Load:1.2 | 🔋85% | projects(main:M) | ±3 | ↑2 | Files: [R]config.js [W]index.ts
```

## File Tracking Indicators
- `[R]` - Reading file
- `[W]` - Writing file
- `[E]` - Editing file

## Requirements
- macOS (uses macOS-specific commands)
- Claude Code CLI
- Git (for repository information)

## Configuration
The status line updates every second by default. Adjust `refreshInterval` in settings.json to change this.

## Troubleshooting

### Status line not showing
1. Check that the script is executable: `chmod +x ~/.claude/statusline-command.sh`
2. Verify the path in settings.json is correct
3. Restart Claude Code

### Missing data
Some data may not appear if:
- Not in a git repository (git info won't show)
- On desktop (battery info won't show)
- No files being accessed (files list will be empty)

## Development Notes
This configuration is part of the Claude Code Ultimate (CCU) optimization suite. All CC-related configurations and optimizations should be committed to the CCU repository for centralized management.