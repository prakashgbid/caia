#!/bin/bash

# Setup CAIA aliases for easy access
# Add these to your shell profile (~/.zshrc or ~/.bashrc)

ADMIN_DIR="/Users/MAC/Documents/projects/admin"
CAIA_DIR="/Users/MAC/Documents/projects/caia"

echo "# CAIA Project Aliases" >> ~/.zshrc
echo "alias caia-status='python3 $ADMIN_DIR/scripts/caia_progress_tracker.py status'" >> ~/.zshrc
echo "alias caia-report='python3 $ADMIN_DIR/scripts/caia_progress_tracker.py report'" >> ~/.zshrc
echo "alias caia-log='python3 $ADMIN_DIR/scripts/caia_progress_tracker.py log'" >> ~/.zshrc
echo "alias caia-task='python3 $ADMIN_DIR/scripts/caia_progress_tracker.py task'" >> ~/.zshrc
echo "alias caia-blocker='python3 $ADMIN_DIR/scripts/caia_progress_tracker.py blocker'" >> ~/.zshrc
echo "alias caia-cd='cd $CAIA_DIR'" >> ~/.zshrc
echo "alias caia-build='cd $CAIA_DIR && npm run build:all'" >> ~/.zshrc
echo "alias caia-test='cd $CAIA_DIR && npm run test:all'" >> ~/.zshrc

echo "✅ CAIA aliases added to ~/.zshrc"
echo ""
echo "Run 'source ~/.zshrc' to activate them"
echo ""
echo "Available commands:"
echo "  caia-status  - Quick status check"
echo "  caia-report  - Full progress report"
echo "  caia-log     - Log progress message"
echo "  caia-task    - Update task status"
echo "  caia-blocker - Add a blocker"
echo "  caia-cd      - Go to CAIA directory"
echo "  caia-build   - Build all packages"
echo "  caia-test    - Test all packages"