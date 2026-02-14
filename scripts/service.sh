#!/bin/bash

# DevPulse launchd Service Manager
# Usage: ./scripts/service.sh [install|uninstall|start|stop|restart|status|logs]

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

SERVER_LABEL="com.devpulse.server"
CLIENT_LABEL="com.devpulse.client"
SERVER_PLIST="$PROJECT_ROOT/launchd/$SERVER_LABEL.plist"
CLIENT_PLIST="$PROJECT_ROOT/launchd/$CLIENT_LABEL.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/DevPulse"

is_loaded() {
    launchctl list "$1" &>/dev/null
}

get_pid() {
    launchctl list 2>/dev/null | awk -v label="$1" '$3 == label {print $1}'
}

cmd_install() {
    echo -e "${BLUE}Installing DevPulse services...${NC}"

    # Create log directory
    mkdir -p "$LOG_DIR"
    echo -e "${GREEN}  Created log directory: $LOG_DIR${NC}"

    # Create LaunchAgents directory if needed
    mkdir -p "$LAUNCH_AGENTS_DIR"

    # Symlink plists
    for label in "$SERVER_LABEL" "$CLIENT_LABEL"; do
        local src="$PROJECT_ROOT/launchd/$label.plist"
        local dest="$LAUNCH_AGENTS_DIR/$label.plist"

        if [ -L "$dest" ] || [ -f "$dest" ]; then
            rm "$dest"
        fi
        ln -s "$src" "$dest"
        echo -e "${GREEN}  Linked $label${NC}"
    done

    # Load services
    for label in "$SERVER_LABEL" "$CLIENT_LABEL"; do
        if is_loaded "$label"; then
            launchctl unload "$LAUNCH_AGENTS_DIR/$label.plist" 2>/dev/null || true
        fi
        launchctl load "$LAUNCH_AGENTS_DIR/$label.plist"
        echo -e "${GREEN}  Loaded $label${NC}"
    done

    echo -e "\n${GREEN}DevPulse services installed and started.${NC}"
    echo -e "Run ${YELLOW}./scripts/service.sh status${NC} to verify."
}

cmd_uninstall() {
    echo -e "${BLUE}Uninstalling DevPulse services...${NC}"

    for label in "$SERVER_LABEL" "$CLIENT_LABEL"; do
        local dest="$LAUNCH_AGENTS_DIR/$label.plist"
        if is_loaded "$label"; then
            launchctl unload "$dest" 2>/dev/null || true
            echo -e "${GREEN}  Unloaded $label${NC}"
        fi
        if [ -L "$dest" ] || [ -f "$dest" ]; then
            rm "$dest"
            echo -e "${GREEN}  Removed $dest${NC}"
        fi
    done

    echo -e "\n${GREEN}DevPulse services uninstalled.${NC}"
}

cmd_start() {
    echo -e "${BLUE}Starting DevPulse services...${NC}"
    for label in "$SERVER_LABEL" "$CLIENT_LABEL"; do
        if ! is_loaded "$label"; then
            echo -e "${RED}  $label is not loaded. Run './scripts/service.sh install' first.${NC}"
            continue
        fi
        launchctl start "$label"
        echo -e "${GREEN}  Started $label${NC}"
    done
}

cmd_stop() {
    echo -e "${BLUE}Stopping DevPulse services...${NC}"
    for label in "$SERVER_LABEL" "$CLIENT_LABEL"; do
        if is_loaded "$label"; then
            launchctl stop "$label"
            echo -e "${GREEN}  Stopped $label${NC}"
        else
            echo -e "${YELLOW}  $label is not loaded, skipping.${NC}"
        fi
    done
}

cmd_restart() {
    cmd_stop
    sleep 2
    cmd_start
}

cmd_status() {
    echo -e "${BLUE}DevPulse Service Status${NC}"
    echo -e "${BLUE}=======================${NC}"

    for label in "$SERVER_LABEL" "$CLIENT_LABEL"; do
        local name="${label##*.}"  # extract "server" or "client"
        if is_loaded "$label"; then
            local pid
            pid=$(get_pid "$label")
            if [ "$pid" = "-" ] || [ -z "$pid" ]; then
                echo -e "  $name: ${YELLOW}loaded but not running${NC}"
            elif [ "$pid" = "0" ]; then
                echo -e "  $name: ${YELLOW}loaded, starting...${NC}"
            else
                echo -e "  $name: ${GREEN}running${NC} (PID $pid)"
            fi
        else
            echo -e "  $name: ${RED}not loaded${NC}"
        fi
    done

    echo ""

    # Check ports
    for port_info in "4000:server" "5173:client"; do
        local port="${port_info%%:*}"
        local name="${port_info##*:}"
        if lsof -ti ":$port" &>/dev/null; then
            echo -e "  Port $port ($name): ${GREEN}in use${NC}"
        else
            echo -e "  Port $port ($name): ${YELLOW}free${NC}"
        fi
    done

    echo ""
    echo -e "  Logs: $LOG_DIR"
}

cmd_logs() {
    local target="${1:-}"

    case "$target" in
        server)
            echo -e "${BLUE}Tailing server logs (Ctrl+C to stop)...${NC}"
            tail -f "$LOG_DIR/server.log" "$LOG_DIR/server.error.log"
            ;;
        client)
            echo -e "${BLUE}Tailing client logs (Ctrl+C to stop)...${NC}"
            tail -f "$LOG_DIR/client.log" "$LOG_DIR/client.error.log"
            ;;
        "")
            echo -e "${BLUE}Tailing all logs (Ctrl+C to stop)...${NC}"
            tail -f "$LOG_DIR"/*.log
            ;;
        *)
            echo -e "${RED}Unknown log target: $target${NC}"
            echo "Usage: $0 logs [server|client]"
            exit 1
            ;;
    esac
}

usage() {
    echo "DevPulse Service Manager"
    echo ""
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  install     Install and start launchd services (auto-start on login)"
    echo "  uninstall   Stop and remove launchd services"
    echo "  start       Start services (must be installed first)"
    echo "  stop        Stop services"
    echo "  restart     Stop then start services"
    echo "  status      Show running state and port info"
    echo "  logs        Tail all log files"
    echo "  logs server Tail server logs only"
    echo "  logs client Tail client logs only"
}

case "${1:-}" in
    install)    cmd_install ;;
    uninstall)  cmd_uninstall ;;
    start)      cmd_start ;;
    stop)       cmd_stop ;;
    restart)    cmd_restart ;;
    status)     cmd_status ;;
    logs)       cmd_logs "${2:-}" ;;
    *)          usage; exit 1 ;;
esac
