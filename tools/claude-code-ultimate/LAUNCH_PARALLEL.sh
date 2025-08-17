#!/bin/bash

# Claude Code Ultimate - Master Parallel Launcher
# Orchestrates 82 parallel Claude Code instances for ultimate configuration

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# ASCII Art Banner
show_banner() {
    echo -e "${CYAN}"
    cat << "EOF"
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗                 ║
║  ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝                 ║
║  ██║     ██║     ███████║██║   ██║██║  ██║█████╗                   ║
║  ██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝                   ║
║  ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗                 ║
║   ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝                 ║
║                                                                      ║
║   ██╗   ██╗██╗  ████████╗██╗███╗   ███╗ █████╗ ████████╗███████╗   ║
║   ██║   ██║██║  ╚══██╔══╝██║████╗ ████║██╔══██╗╚══██╔══╝██╔════╝   ║
║   ██║   ██║██║     ██║   ██║██╔████╔██║███████║   ██║   █████╗     ║
║   ██║   ██║██║     ██║   ██║██║╚██╔╝██║██╔══██║   ██║   ██╔══╝     ║
║   ╚██████╔╝███████╗██║   ██║██║ ╚═╝ ██║██║  ██║   ██║   ███████╗   ║
║    ╚═════╝ ╚══════╝╚═╝   ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝   ║
║                                                                      ║
║              🚀 82 PARALLEL CONFIGURATIONS 🚀                       ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"
    
    local missing=0
    
    # Check Claude Code
    if ! command -v claude &> /dev/null; then
        echo -e "${RED}  ❌ Claude Code not installed${NC}"
        echo "     Install: npm install -g @anthropic-ai/claude-code"
        missing=1
    else
        echo -e "${GREEN}  ✅ Claude Code installed${NC}"
    fi
    
    # Check Python 3
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}  ❌ Python 3 not found${NC}"
        missing=1
    else
        echo -e "${GREEN}  ✅ Python 3 available${NC}"
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}  ❌ Node.js not found${NC}"
        missing=1
    else
        echo -e "${GREEN}  ✅ Node.js available${NC}"
    fi
    
    # Check for tmux or ability to open terminals
    if command -v tmux &> /dev/null; then
        echo -e "${GREEN}  ✅ tmux available${NC}"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${GREEN}  ✅ macOS Terminal available${NC}"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v gnome-terminal &> /dev/null || command -v xterm &> /dev/null; then
            echo -e "${GREEN}  ✅ Linux terminal available${NC}"
        else
            echo -e "${YELLOW}  ⚠️  No terminal emulator detected, will use tmux${NC}"
        fi
    fi
    
    # Check API key
    if [[ -z "${ANTHROPIC_API_KEY}" ]]; then
        echo -e "${YELLOW}  ⚠️  ANTHROPIC_API_KEY not set in environment${NC}"
        echo "     Set it with: export ANTHROPIC_API_KEY='your-key'"
    else
        echo -e "${GREEN}  ✅ API key configured${NC}"
    fi
    
    if [ $missing -eq 1 ]; then
        echo -e "\n${RED}Please install missing prerequisites before continuing.${NC}"
        return 1
    fi
    
    return 0
}

# Display system resources
show_system_info() {
    echo -e "\n${CYAN}💻 System Information:${NC}"
    
    # OS Info
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "  OS: macOS $(sw_vers -productVersion)"
        echo -e "  CPU: $(sysctl -n hw.ncpu) cores"
        echo -e "  RAM: $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 )) GB"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo -e "  OS: $(lsb_release -d | cut -f2)"
        echo -e "  CPU: $(nproc) cores"
        echo -e "  RAM: $(free -h | awk '/^Mem:/ {print $2}')"
    fi
    
    # Disk space
    echo -e "  Disk: $(df -h . | awk 'NR==2 {print $4}') available"
}

# Show configuration summary
show_config_summary() {
    echo -e "\n${MAGENTA}📊 Configuration Summary:${NC}"
    
    # Count items by priority
    local critical=$(grep -c "🔴 CRITICAL" ENHANCEMENT_MATRIX.md 2>/dev/null || echo 0)
    local high=$(grep -c "🟡 HIGH" ENHANCEMENT_MATRIX.md 2>/dev/null || echo 0)
    local medium=$(grep -c "🟢 MEDIUM" ENHANCEMENT_MATRIX.md 2>/dev/null || echo 0)
    
    echo -e "  🔴 Critical Priority: $critical items"
    echo -e "  🟡 High Priority: $high items"
    echo -e "  🟢 Medium Priority: $medium items"
    echo -e "  📦 Total Configurations: 82 items"
    
    echo -e "\n${YELLOW}📋 Categories to Configure:${NC}"
    echo "  1. Core Configuration Files"
    echo "  2. Memory & Context Management"
    echo "  3. Performance Optimizations"
    echo "  4. Agent & Orchestration Systems"
    echo "  5. MCP Server Ecosystem"
    echo "  6. Automation & Hooks"
    echo "  7. CI/CD & DevOps Integration"
    echo "  8. Advanced Intelligence Features"
    echo "  9. Speed & Efficiency Configurations"
    echo "  10. Security & Compliance"
    echo "  11. Project Management Integration"
    echo "  12. Testing & Quality Assurance"
}

# Launch method selection
select_launch_method() {
    echo -e "\n${CYAN}🚀 Select Launch Method:${NC}"
    echo "  1) GUI Terminals (82 separate windows) - Recommended for visual monitoring"
    echo "  2) tmux Sessions (single terminal) - Recommended for servers/SSH"
    echo "  3) Python Orchestrator (advanced) - Full control and monitoring"
    echo "  4) Exit"
    
    read -p "$(echo -e ${GREEN}Select option [1-4]: ${NC})" choice
    
    case $choice in
        1)
            launch_gui_terminals
            ;;
        2)
            launch_tmux_sessions
            ;;
        3)
            launch_python_orchestrator
            ;;
        4)
            echo -e "${YELLOW}👋 Exiting...${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            select_launch_method
            ;;
    esac
}

# Launch using GUI terminals
launch_gui_terminals() {
    echo -e "\n${YELLOW}🖥️  Launching in GUI terminals...${NC}"
    echo -e "${RED}⚠️  WARNING: This will open 82 terminal windows!${NC}"
    
    read -p "$(echo -e ${GREEN}Continue? [yes/no]: ${NC})" confirm
    if [[ "$confirm" != "yes" ]]; then
        select_launch_method
        return
    fi
    
    python3 parallel_orchestrator.py
}

# Launch using tmux
launch_tmux_sessions() {
    echo -e "\n${YELLOW}📺 Launching in tmux...${NC}"
    echo -e "${CYAN}This will create a tmux session with 82 panes/windows${NC}"
    
    read -p "$(echo -e ${GREEN}Continue? [yes/no]: ${NC})" confirm
    if [[ "$confirm" != "yes" ]]; then
        select_launch_method
        return
    fi
    
    ./parallel_launcher_tmux.sh
}

# Launch using Python orchestrator
launch_python_orchestrator() {
    echo -e "\n${YELLOW}🐍 Launching with Python orchestrator...${NC}"
    
    read -p "$(echo -e ${GREEN}Continue? [yes/no]: ${NC})" confirm
    if [[ "$confirm" != "yes" ]]; then
        select_launch_method
        return
    fi
    
    python3 parallel_orchestrator.py
}

# Monitor progress
monitor_progress() {
    echo -e "\n${CYAN}📊 Monitoring Options:${NC}"
    echo "  1) Real-time Dashboard (interactive)"
    echo "  2) Simple Progress Bar"
    echo "  3) Detailed Logs"
    echo "  4) Skip Monitoring"
    
    read -p "$(echo -e ${GREEN}Select option [1-4]: ${NC})" choice
    
    case $choice in
        1)
            python3 monitor_dashboard.py
            ;;
        2)
            watch -n 5 'echo "Progress: $(ls parallel_results/*.json 2>/dev/null | wc -l)/82 completed"'
            ;;
        3)
            tail -f parallel_logs/*.txt
            ;;
        4)
            echo -e "${YELLOW}Skipping monitoring${NC}"
            ;;
    esac
}

# Aggregate results
aggregate_results() {
    echo -e "\n${CYAN}📋 Aggregating Results...${NC}"
    
    if [ -d "parallel_results" ] && [ "$(ls -A parallel_results)" ]; then
        python3 aggregate_results.py
    else
        echo -e "${YELLOW}No results to aggregate yet${NC}"
    fi
}

# Main execution flow
main() {
    clear
    show_banner
    
    # Check prerequisites
    if ! check_prerequisites; then
        exit 1
    fi
    
    # Show system info
    show_system_info
    
    # Show configuration summary
    show_config_summary
    
    # Warning message
    echo -e "\n${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                         ⚠️  WARNING ⚠️                        ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}║  This will launch 82 PARALLEL Claude Code instances!        ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}║  Requirements:                                              ║${NC}"
    echo -e "${RED}║  • Sufficient API credits for 82 concurrent sessions        ║${NC}"
    echo -e "${RED}║  • At least 16GB RAM recommended                           ║${NC}"
    echo -e "${RED}║  • Good internet connection                                ║${NC}"
    echo -e "${RED}║  • ~30-60 minutes for full execution                       ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    
    echo ""
    read -p "$(echo -e ${GREEN}Ready to transform Claude Code? [yes/no]: ${NC})" ready
    
    if [[ "$ready" != "yes" ]]; then
        echo -e "${YELLOW}👋 Maybe next time!${NC}"
        exit 0
    fi
    
    # Select launch method
    select_launch_method
    
    # Option to monitor
    echo ""
    read -p "$(echo -e ${GREEN}Monitor progress? [yes/no]: ${NC})" monitor
    if [[ "$monitor" == "yes" ]]; then
        monitor_progress
    fi
    
    # Aggregate results
    echo ""
    read -p "$(echo -e ${GREEN}Aggregate results? [yes/no]: ${NC})" aggregate
    if [[ "$aggregate" == "yes" ]]; then
        aggregate_results
    fi
    
    echo -e "\n${GREEN}✨ Claude Code Ultimate Parallel Configuration Complete!${NC}"
    echo -e "${CYAN}Check ENHANCEMENT_MATRIX.md for updated status${NC}"
    echo -e "${CYAN}View detailed report in PARALLEL_EXECUTION_REPORT.md${NC}"
}

# Handle interrupts gracefully
trap 'echo -e "\n${YELLOW}Interrupted! Cleaning up...${NC}"; exit 1' INT TERM

# Run main
main "$@"