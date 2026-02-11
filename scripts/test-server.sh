#!/usr/bin/env bash

# DevPulse Server Test Script
# Tests all API endpoints with color-coded output

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SERVER_URL="http://localhost:4000"
WS_URL="ws://localhost:4000/stream"
TEST_PROJECT_NAME="TestProject"
TEST_SESSION_ID="test-session-$(date +%s)"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
print_header() {
    echo -e "\n${CYAN}========================================${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}========================================${NC}\n"
}

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((TESTS_PASSED++))
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((TESTS_FAILED++))
}

print_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# Check if server is running
check_server() {
    print_header "1. Server Availability Check"
    print_test "Checking if server is running on port 4000..."

    if curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL" | grep -q "200"; then
        print_pass "Server is running and responding"
        return 0
    else
        print_fail "Server is not running on port 4000"
        print_info "Start the server with: cd apps/server && bun dev"
        exit 1
    fi
}

# Test SessionStart event
test_session_start() {
    print_header "2. SessionStart Event"
    print_test "Sending SessionStart event..."

    TIMESTAMP=$(date +%s%3N)

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SERVER_URL/events" \
        -H "Content-Type: application/json" \
        -d "{
            \"source_app\": \"$TEST_PROJECT_NAME\",
            \"session_id\": \"$TEST_SESSION_ID\",
            \"hook_event_type\": \"SessionStart\",
            \"payload\": {
                \"cwd\": \"/home/user/projects/test\",
                \"agent_type\": \"main\"
            },
            \"timestamp\": $TIMESTAMP
        }")

    STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$STATUS_CODE" = "200" ]; then
        if echo "$BODY" | grep -q "\"id\""; then
            print_pass "SessionStart event created (status: $STATUS_CODE)"
            print_info "Response: $BODY"
            # Extract event ID for later use
            EVENT_ID=$(echo "$BODY" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
            print_info "Event ID: $EVENT_ID"
        else
            print_fail "Response missing 'id' field"
        fi
    else
        print_fail "Failed to create SessionStart event (status: $STATUS_CODE)"
        print_info "Response: $BODY"
    fi

    # Give enricher time to process
    sleep 1
}

# Test GET /api/projects
test_get_projects() {
    print_header "3. GET /api/projects"
    print_test "Fetching all projects..."

    RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/api/projects")
    STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$STATUS_CODE" = "200" ]; then
        if echo "$BODY" | grep -q "\"name\":\"$TEST_PROJECT_NAME\""; then
            print_pass "Projects endpoint working, found test project"
            print_info "Response: $BODY"
        else
            print_fail "Test project not found in response"
            print_info "Response: $BODY"
        fi
    else
        print_fail "Failed to fetch projects (status: $STATUS_CODE)"
    fi
}

# Test GET /api/sessions
test_get_sessions() {
    print_header "4. GET /api/sessions"
    print_test "Fetching active sessions..."

    RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/api/sessions")
    STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$STATUS_CODE" = "200" ]; then
        if echo "$BODY" | grep -q "\"session_id\":\"$TEST_SESSION_ID\""; then
            print_pass "Sessions endpoint working, found test session"
            print_info "Response: $BODY"
        else
            print_fail "Test session not found in response"
            print_info "Response: $BODY"
        fi
    else
        print_fail "Failed to fetch sessions (status: $STATUS_CODE)"
    fi
}

# Test PostToolUse events
test_post_tool_use() {
    print_header "5. PostToolUse Events"
    print_test "Sending multiple PostToolUse events..."

    # Send 3 different tool use events
    TOOLS=("Read" "Edit" "Bash")
    SUCCESS_COUNT=0

    for TOOL in "${TOOLS[@]}"; do
        TIMESTAMP=$(date +%s%3N)

        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SERVER_URL/events" \
            -H "Content-Type: application/json" \
            -d "{
                \"source_app\": \"$TEST_PROJECT_NAME\",
                \"session_id\": \"$TEST_SESSION_ID\",
                \"hook_event_type\": \"PostToolUse\",
                \"payload\": {
                    \"tool_name\": \"$TOOL\",
                    \"tool_input\": {\"file_path\": \"/src/app.ts\"},
                    \"cwd\": \"/home/user/projects/test\"
                },
                \"timestamp\": $TIMESTAMP
            }")

        STATUS_CODE=$(echo "$RESPONSE" | tail -n1)

        if [ "$STATUS_CODE" = "200" ]; then
            ((SUCCESS_COUNT++))
            print_info "Sent $TOOL event successfully"
        else
            print_info "Failed to send $TOOL event (status: $STATUS_CODE)"
        fi

        sleep 0.5
    done

    if [ "$SUCCESS_COUNT" -eq 3 ]; then
        print_pass "All PostToolUse events sent successfully"
    else
        print_fail "Only $SUCCESS_COUNT/3 PostToolUse events succeeded"
    fi
}

# Test SessionEnd event
test_session_end() {
    print_header "6. SessionEnd Event"
    print_test "Sending SessionEnd event to trigger dev log generation..."

    TIMESTAMP=$(date +%s%3N)

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SERVER_URL/events" \
        -H "Content-Type: application/json" \
        -d "{
            \"source_app\": \"$TEST_PROJECT_NAME\",
            \"session_id\": \"$TEST_SESSION_ID\",
            \"hook_event_type\": \"SessionEnd\",
            \"payload\": {
                \"cwd\": \"/home/user/projects/test\",
                \"reason\": \"user_exit\"
            },
            \"timestamp\": $TIMESTAMP
        }")

    STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$STATUS_CODE" = "200" ]; then
        print_pass "SessionEnd event created (status: $STATUS_CODE)"
        print_info "Response: $BODY"
    else
        print_fail "Failed to create SessionEnd event (status: $STATUS_CODE)"
        print_info "Response: $BODY"
    fi

    # Give dev log generator time to process
    print_info "Waiting 2 seconds for dev log generation..."
    sleep 2
}

# Test GET /api/devlogs
test_get_devlogs() {
    print_header "7. GET /api/devlogs"
    print_test "Fetching dev logs..."

    RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/api/devlogs")
    STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$STATUS_CODE" = "200" ]; then
        if echo "$BODY" | grep -q "\"session_id\":\"$TEST_SESSION_ID\""; then
            print_pass "Dev logs endpoint working, found test session log"
            print_info "Response: $BODY"

            # Check for tool_breakdown
            if echo "$BODY" | grep -q "\"tool_breakdown\""; then
                print_pass "Dev log contains tool_breakdown field"
            else
                print_fail "Dev log missing tool_breakdown field"
            fi
        else
            print_fail "Test session dev log not found in response"
            print_info "Response: $BODY"
        fi
    else
        print_fail "Failed to fetch dev logs (status: $STATUS_CODE)"
    fi
}

# Test GET /events/recent
test_get_recent_events() {
    print_header "8. GET /events/recent"
    print_test "Fetching recent events..."

    RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/events/recent?limit=10")
    STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$STATUS_CODE" = "200" ]; then
        if echo "$BODY" | grep -q "\"session_id\":\"$TEST_SESSION_ID\""; then
            print_pass "Recent events endpoint working"
            EVENT_COUNT=$(echo "$BODY" | grep -o "\"session_id\"" | wc -l)
            print_info "Found $EVENT_COUNT events in response"
        else
            print_fail "Test session events not found in recent events"
        fi
    else
        print_fail "Failed to fetch recent events (status: $STATUS_CODE)"
    fi
}

# Test GET /events/filter-options
test_get_filter_options() {
    print_header "9. GET /events/filter-options"
    print_test "Fetching filter options..."

    RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/events/filter-options")
    STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$STATUS_CODE" = "200" ]; then
        if echo "$BODY" | grep -q "\"sourceApps\""; then
            print_pass "Filter options endpoint working"
            print_info "Response: $BODY"
        else
            print_fail "Filter options missing expected fields"
        fi
    else
        print_fail "Failed to fetch filter options (status: $STATUS_CODE)"
    fi
}

# Test WebSocket connection (if websocat is available)
test_websocket() {
    print_header "10. WebSocket Connection"

    if command -v websocat &> /dev/null; then
        print_test "Testing WebSocket connection with websocat..."

        # Connect and capture first few messages (timeout after 3 seconds)
        WS_OUTPUT=$(timeout 3s websocat -n1 "$WS_URL" 2>&1 || true)

        if echo "$WS_OUTPUT" | grep -q "\"type\":\"initial\""; then
            print_pass "WebSocket connection successful, received 'initial' message"
        elif echo "$WS_OUTPUT" | grep -q "\"type\""; then
            print_pass "WebSocket connection successful, received messages"
            print_info "Output: $WS_OUTPUT"
        else
            print_fail "WebSocket connection failed or no messages received"
            print_info "Output: $WS_OUTPUT"
        fi
    else
        print_info "websocat not installed, skipping WebSocket test"
        print_info "Install with: brew install websocat (macOS) or cargo install websocat"
    fi
}

# Cleanup function
cleanup() {
    print_header "Cleanup"
    print_info "Test data will remain in the database for inspection"
    print_info "To reset the database, run: ./scripts/reset-system.sh"
}

# Print summary
print_summary() {
    print_header "Test Summary"

    TOTAL=$((TESTS_PASSED + TESTS_FAILED))

    echo -e "Total tests: $TOTAL"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"

    if [ "$TESTS_FAILED" -eq 0 ]; then
        echo -e "\n${GREEN}✓ All tests passed!${NC}\n"
        return 0
    else
        echo -e "\n${RED}✗ Some tests failed${NC}\n"
        return 1
    fi
}

# Main execution
main() {
    print_header "DevPulse Server Test Suite"
    print_info "Testing server at: $SERVER_URL"
    print_info "Test session ID: $TEST_SESSION_ID"

    check_server
    test_session_start
    test_get_projects
    test_get_sessions
    test_post_tool_use
    test_session_end
    test_get_devlogs
    test_get_recent_events
    test_get_filter_options
    test_websocket

    cleanup
    print_summary
}

# Handle script arguments
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "DevPulse Server Test Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "OPTIONS:"
    echo "  --help, -h    Show this help message"
    echo "  --cleanup     Just show cleanup instructions"
    echo ""
    echo "This script tests all DevPulse server API endpoints:"
    echo "  - POST /events (SessionStart, PostToolUse, SessionEnd)"
    echo "  - GET /api/projects"
    echo "  - GET /api/sessions"
    echo "  - GET /api/devlogs"
    echo "  - GET /events/recent"
    echo "  - GET /events/filter-options"
    echo "  - WebSocket connection (if websocat is installed)"
    echo ""
    echo "Prerequisites:"
    echo "  - Server must be running on port 4000"
    echo "  - Start with: cd apps/server && bun dev"
    exit 0
fi

if [ "$1" = "--cleanup" ]; then
    cleanup
    exit 0
fi

# Run tests
main
