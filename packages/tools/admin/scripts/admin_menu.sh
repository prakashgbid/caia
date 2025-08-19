#!/bin/bash

# Admin Commands Menu System for Claude Code
# Triggered by typing % in Claude Code

ADMIN_DIR="/Users/MAC/Documents/projects/admin"
SCRIPTS_DIR="$ADMIN_DIR/scripts"

# Colors for better visibility
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

show_menu() {
    clear
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${YELLOW}          🎯 CAIA-ADMIN COMMAND CENTER 🎯${NC}"
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo
    echo -e "${BOLD}${GREEN}📊 Context & Status Commands:${NC}"
    echo -e "  ${CYAN}1${NC}  → Quick Status Overview        ${MAGENTA}[admin/scripts/quick_status.sh]${NC}"
    echo -e "  ${CYAN}2${NC}  → CAIA Project Status         ${MAGENTA}[admin/scripts/caia_status.sh]${NC}"
    echo -e "  ${CYAN}3${NC}  → Executive Summary           ${MAGENTA}[query_context.py --command summary]${NC}"
    echo -e "  ${CYAN}4${NC}  → Recent Decisions (7 days)   ${MAGENTA}[query_context.py --command decisions]${NC}"
    echo -e "  ${CYAN}5${NC}  → Project-Specific Summary    ${MAGENTA}[query_context.py --command project]${NC}"
    echo
    echo -e "${BOLD}${GREEN}📝 Decision Logging:${NC}"
    echo -e "  ${CYAN}6${NC}  → Log Architecture Decision   ${MAGENTA}[log_decision.py --type decision]${NC}"
    echo -e "  ${CYAN}7${NC}  → Log Progress Update         ${MAGENTA}[log_decision.py --type progress]${NC}"
    echo -e "  ${CYAN}8${NC}  → Log Discussion/Meeting      ${MAGENTA}[log_decision.py --type discussion]${NC}"
    echo
    echo -e "${BOLD}${GREEN}🚀 Performance & Testing:${NC}"
    echo -e "  ${CYAN}9${NC}  → Test CCU Integration        ${MAGENTA}[test_ccu_integration.sh]${NC}"
    echo -e "  ${CYAN}10${NC} → Test CCO Integration        ${MAGENTA}[test_cco_integration.sh]${NC}"
    echo -e "  ${CYAN}11${NC} → Verify CCO Status           ${MAGENTA}[verify_cco.sh]${NC}"
    echo
    echo -e "${BOLD}${GREEN}🔧 CAIA Management:${NC}"
    echo -e "  ${CYAN}12${NC} → CAIA Progress Tracker       ${MAGENTA}[caia_progress_tracker.py]${NC}"
    echo -e "  ${CYAN}13${NC} → CAIA Component Tracker      ${MAGENTA}[caia_tracker.py]${NC}"
    echo -e "  ${CYAN}14${NC} → Enable CCO Integration      ${MAGENTA}[enable_cco_integration.sh]${NC}"
    echo
    echo -e "${BOLD}${GREEN}🎮 Context Daemon:${NC}"
    echo -e "  ${CYAN}15${NC} → Start Context Daemon        ${MAGENTA}[start_context_daemon.sh]${NC}"
    echo -e "  ${CYAN}16${NC} → Stop Context Daemon         ${MAGENTA}[stop_context_daemon.sh]${NC}"
    echo -e "  ${CYAN}17${NC} → Manual Context Capture      ${MAGENTA}[capture_context.py --hours 24]${NC}"
    echo
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "  ${YELLOW}q${NC}  → Quit Menu"
    echo -e "  ${YELLOW}h${NC}  → Show Help & Examples"
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo
    echo -ne "${BOLD}Select command (1-17, h, q): ${NC}"
}

show_help() {
    clear
    echo -e "${BOLD}${YELLOW}📚 ADMIN COMMANDS HELP & EXAMPLES${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo
    echo -e "${BOLD}Quick Examples:${NC}"
    echo
    echo -e "${GREEN}Log a decision:${NC}"
    echo "python3 $SCRIPTS_DIR/log_decision.py \\"
    echo "  --type decision \\"
    echo "  --title \"Chose microservices architecture\" \\"
    echo "  --description \"Better scalability for CAIA\" \\"
    echo "  --project caia"
    echo
    echo -e "${GREEN}Track progress:${NC}"
    echo "python3 $SCRIPTS_DIR/log_decision.py \\"
    echo "  --type progress \\"
    echo "  --title \"Completed JIRA integration\" \\"
    echo "  --status completed \\"
    echo "  --completion 100"
    echo
    echo -e "${GREEN}Query specific project:${NC}"
    echo "python3 $SCRIPTS_DIR/query_context.py \\"
    echo "  --command project --project roulette-community"
    echo
    echo -e "${YELLOW}Press any key to return to menu...${NC}"
    read -n 1
}

execute_command() {
    case $1 in
        1) $SCRIPTS_DIR/quick_status.sh ;;
        2) $SCRIPTS_DIR/caia_status.sh ;;
        3) python3 $SCRIPTS_DIR/query_context.py --command summary ;;
        4) python3 $SCRIPTS_DIR/query_context.py --command decisions --days 7 ;;
        5) 
            echo -n "Enter project name: "
            read project
            python3 $SCRIPTS_DIR/query_context.py --command project --project "$project"
            ;;
        6)
            echo "Log Architecture Decision"
            echo -n "Title: "
            read title
            echo -n "Description: "
            read desc
            echo -n "Project: "
            read proj
            python3 $SCRIPTS_DIR/log_decision.py --type decision --title "$title" --description "$desc" --project "$proj" --category architecture
            ;;
        7)
            echo "Log Progress Update"
            echo -n "Title: "
            read title
            echo -n "Description: "
            read desc
            echo -n "Project: "
            read proj
            echo -n "Completion (0-100): "
            read completion
            python3 $SCRIPTS_DIR/log_decision.py --type progress --title "$title" --description "$desc" --project "$proj" --completion $completion
            ;;
        8)
            echo "Log Discussion"
            echo -n "Title: "
            read title
            echo -n "Description: "
            read desc
            echo -n "Project: "
            read proj
            python3 $SCRIPTS_DIR/log_decision.py --type discussion --title "$title" --description "$desc" --project "$proj"
            ;;
        9) $SCRIPTS_DIR/test_ccu_integration.sh ;;
        10) $SCRIPTS_DIR/test_cco_integration.sh ;;
        11) $SCRIPTS_DIR/verify_cco.sh ;;
        12) python3 $SCRIPTS_DIR/caia_progress_tracker.py status ;;
        13) python3 $SCRIPTS_DIR/caia_tracker.py ;;
        14) $SCRIPTS_DIR/enable_cco_integration.sh ;;
        15) $SCRIPTS_DIR/start_context_daemon.sh ;;
        16) $SCRIPTS_DIR/stop_context_daemon.sh ;;
        17) python3 $SCRIPTS_DIR/capture_context.py --hours 24 ;;
        h) show_help ;;
        q) echo "Exiting admin menu..."; exit 0 ;;
        *) echo "Invalid option" ;;
    esac
    
    if [[ "$1" != "h" && "$1" != "q" ]]; then
        echo
        echo -e "${YELLOW}Press any key to continue...${NC}"
        read -n 1
    fi
}

# Main loop
while true; do
    show_menu
    read choice
    execute_command $choice
done