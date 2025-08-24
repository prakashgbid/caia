#!/bin/bash

# Claude Code Status Line Installer
# Part of Claude Code Ultimate (CCU) configuration suite

echo "🚀 Installing Claude Code Status Line Configuration..."

# Check if Claude settings directory exists
if [ ! -d "$HOME/.claude" ]; then
    echo "Creating ~/.claude directory..."
    mkdir -p "$HOME/.claude"
fi

# Backup existing statusline if it exists
if [ -f "$HOME/.claude/statusline-command.sh" ]; then
    echo "Backing up existing statusline configuration..."
    cp "$HOME/.claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Copy statusline script
echo "Installing statusline script..."
cp "$(dirname "$0")/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
chmod +x "$HOME/.claude/statusline-command.sh"

# Update settings.json
SETTINGS_FILE="$HOME/.claude/settings.json"

if [ ! -f "$SETTINGS_FILE" ]; then
    echo "Creating new settings.json..."
    cp "$(dirname "$0")/settings-with-statusline.json" "$SETTINGS_FILE"
else
    echo "Updating existing settings.json..."
    # Check if statusLine already exists
    if grep -q '"statusLine"' "$SETTINGS_FILE"; then
        echo "⚠️  Status line configuration already exists in settings.json"
        echo "   Please manually verify the configuration is correct."
    else
        echo "Adding statusLine configuration to settings.json..."
        # This is a simplified update - in production, use jq for proper JSON manipulation
        echo ""
        echo "⚠️  Please manually add the following to your settings.json:"
        echo ""
        echo '  "statusLine": {'
        echo '    "command": "'$HOME'/.claude/statusline-command.sh",'
        echo '    "refreshInterval": 1000'
        echo '  }'
        echo ""
    fi
fi

echo ""
echo "✅ Status Line Installation Complete!"
echo ""
echo "Features enabled:"
echo "  • Real-time CPU, RAM, and system metrics"
echo "  • Git branch and commit tracking"
echo "  • File access monitoring"
echo "  • Parallel process counting"
echo "  • Session duration tracking"
echo ""
echo "The status line will appear at the bottom of your Claude Code interface."
echo "Restart Claude Code if the status line doesn't appear immediately."
echo ""
echo "For more information, see: configs/statusline/README.md"