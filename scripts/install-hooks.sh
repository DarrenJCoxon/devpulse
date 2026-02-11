#!/bin/bash
# DevPulse Hook Installer
# Usage: ./scripts/install-hooks.sh /path/to/project "ProjectName"
#
# Installs Claude Code hooks that send events to the DevPulse server.
# This copies the hook scripts and creates/updates .claude/settings.json
# in the target project.

set -e

DEVPULSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$1"
PROJECT_NAME="$2"
SERVER_URL="${3:-http://localhost:4000/events}"

if [ -z "$TARGET_DIR" ] || [ -z "$PROJECT_NAME" ]; then
  echo "DevPulse Hook Installer"
  echo ""
  echo "Usage: $0 <project-path> <project-name> [server-url]"
  echo ""
  echo "  project-path  Path to the project directory"
  echo "  project-name  Name to identify this project in DevPulse (e.g. ClassForge)"
  echo "  server-url    DevPulse server URL (default: http://localhost:4000/events)"
  echo ""
  echo "Examples:"
  echo "  $0 ~/Documents/Codebases/classforge ClassForge"
  echo "  $0 ~/Documents/Codebases/whitespace WhiteSpace"
  echo "  $0 ~/Documents/Codebases/bridge-ai BridgeAI"
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Directory does not exist: $TARGET_DIR"
  exit 1
fi

echo "📡 DevPulse Hook Installer"
echo "  Project: $PROJECT_NAME"
echo "  Path:    $TARGET_DIR"
echo "  Server:  $SERVER_URL"
echo ""

# Create .claude/hooks directory in target project
HOOKS_DIR="$TARGET_DIR/.claude/hooks"
mkdir -p "$HOOKS_DIR"
mkdir -p "$HOOKS_DIR/utils"
mkdir -p "$HOOKS_DIR/utils/llm"
mkdir -p "$HOOKS_DIR/utils/tts"
mkdir -p "$HOOKS_DIR/validators"

# Copy hook scripts from DevPulse's .claude/hooks
echo "📋 Copying hook scripts..."
cp "$DEVPULSE_DIR/.claude/hooks/"*.py "$HOOKS_DIR/" 2>/dev/null || true
cp "$DEVPULSE_DIR/.claude/hooks/utils/"*.py "$HOOKS_DIR/utils/" 2>/dev/null || true
cp "$DEVPULSE_DIR/.claude/hooks/utils/llm/"*.py "$HOOKS_DIR/utils/llm/" 2>/dev/null || true
cp "$DEVPULSE_DIR/.claude/hooks/utils/tts/"*.py "$HOOKS_DIR/utils/tts/" 2>/dev/null || true
cp "$DEVPULSE_DIR/.claude/hooks/validators/"*.py "$HOOKS_DIR/validators/" 2>/dev/null || true

# Generate settings.json with project-specific --source-app
SETTINGS_FILE="$TARGET_DIR/.claude/settings.json"

# Check if settings already exist
if [ -f "$SETTINGS_FILE" ]; then
  echo "⚠️  Existing .claude/settings.json found."
  echo "   Backing up to .claude/settings.json.backup"
  cp "$SETTINGS_FILE" "${SETTINGS_FILE}.backup"
fi

echo "⚙️  Writing .claude/settings.json..."

cat > "$SETTINGS_FILE" << SETTINGS_EOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/pre_tool_use.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type PreToolUse --summarize"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/post_tool_use.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type PostToolUse --summarize"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/notification.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type Notification --summarize"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/stop.py --chat"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type Stop --add-chat"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/subagent_stop.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type SubagentStop"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/pre_compact.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type PreCompact"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/user_prompt_submit.py --log-only --store-last-prompt --name-agent"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type UserPromptSubmit --summarize"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/session_start.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type SessionStart"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/session_end.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type SessionEnd"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/permission_request.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type PermissionRequest --summarize"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/post_tool_use_failure.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type PostToolUseFailure --summarize"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/subagent_start.py"
          },
          {
            "type": "command",
            "command": "uv run \$CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app ${PROJECT_NAME} --event-type SubagentStart"
          }
        ]
      }
    ]
  }
}
SETTINGS_EOF

echo ""
echo "✅ DevPulse hooks installed for ${PROJECT_NAME}!"
echo ""
echo "   Next steps:"
echo "   1. Start DevPulse server:  cd $(basename $DEVPULSE_DIR) && ./scripts/start-system.sh"
echo "   2. Open dashboard:         http://localhost:5173"
echo "   3. Start Claude Code in:   cd $TARGET_DIR && claude"
echo ""
echo "   Events will appear in the dashboard as you work."
echo ""
echo "   To uninstall, remove: $TARGET_DIR/.claude/hooks/"
echo "   And restore: ${SETTINGS_FILE}.backup (if exists)"
