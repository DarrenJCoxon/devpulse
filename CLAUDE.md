# DevPulse - Multi-Session Development Dashboard

## Project Overview
DevPulse is a real-time monitoring dashboard for concurrent Claude Code sessions across multiple projects. It extends the open-source [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) project with project-level intelligence, automated dev logs, and infrastructure monitoring.

**Owner**: Darren Coxon (Kompass Education / Floe Studio)

### REMEMBER: Use source_app + session_id to uniquely identify an agent.
Every hook event includes source_app and session_id. Display as "source_app:session_id" with session_id truncated to first 8 characters.

## Architecture

```
Claude Code Agents → Hook Scripts (Python/uv) → HTTP POST → Bun Server → SQLite → WebSocket → Vue 3 Client
```

### What's New (DevPulse enhancements over base repo)

1. **Project Enricher** (`apps/server/src/enricher.ts`) - When events arrive, enriches them with:
   - Git context: current branch, recent commits, uncommitted file count
   - Project identity: maps `cwd` to a project name
   - Dev server detection: scans for running localhost ports
   - Test status: tracks last test run results from tool use events

2. **Projects Table** - Tracks each project with latest status:
   - Name, path, current branch, active session count
   - Last activity timestamp, running dev servers, test status

3. **Dev Logs** (`apps/server/src/devlog.ts`) - Auto-generated session summaries:
   - On SessionEnd/Stop, summarises what was accomplished
   - Stored as structured entries (project, branch, summary, files changed)
   - Searchable timeline view in dashboard

4. **Project Overview Dashboard** - New Vue component showing card-per-project:
   - Active/idle/waiting status per session
   - Current branch and recent commits
   - Running dev servers with port numbers
   - Test pass/fail status

## Tech Stack
- **Server**: Bun, TypeScript, SQLite (WAL mode)
- **Client**: Vue 3 (Composition API), TypeScript, Vite, Tailwind CSS
- **Hooks**: Python 3.8+, Astral uv (inline script dependencies)
- **Communication**: HTTP REST + WebSocket

## Commands
```bash
# Start everything
./scripts/start-system.sh

# Start individually
cd apps/server && bun dev          # Server on :4000
cd apps/client && bun dev          # Client on :5173

# Install hooks in a project
./scripts/install-hooks.sh /path/to/project "MyProjectName"

# Reset (stop all, clear DB)
./scripts/reset-system.sh
```

## Key Files

### Server
- `apps/server/src/index.ts` - HTTP/WebSocket server, all API routes
- `apps/server/src/db.ts` - SQLite schema, queries
- `apps/server/src/enricher.ts` - NEW: Event enrichment (git, ports, tests)
- `apps/server/src/devlog.ts` - NEW: Dev log generation
- `apps/server/src/types.ts` - TypeScript interfaces

### Client
- `apps/client/src/App.vue` - Main layout with tab navigation
- `apps/client/src/components/ProjectOverview.vue` - NEW: Project cards dashboard
- `apps/client/src/components/DevLogTimeline.vue` - NEW: Session summaries
- `apps/client/src/components/EventTimeline.vue` - Existing event stream
- `apps/client/src/components/LivePulseChart.vue` - Activity pulse chart
- `apps/client/src/composables/useWebSocket.ts` - WebSocket connection

### Hooks
- `.claude/hooks/send_event.py` - Core event sender (all hook types)
- `.claude/hooks/pre_tool_use.py` - Pre-execution validation
- `.claude/hooks/post_tool_use.py` - Post-execution capture
- `scripts/install-hooks.sh` - NEW: Hook installer for any project

## Database Schema
- `events` - Raw hook events (existing)
- `projects` - Project status tracking (new)
- `dev_logs` - Session summaries (new)
- `sessions` - Session lifecycle tracking (new)

## Conventions
- Use Bun, not npm
- TypeScript strict mode
- Vue 3 Composition API with `<script setup>`
- Tailwind for styling, use CSS variables from theme system
- All new API routes go in `apps/server/src/index.ts`
- Python hooks use `uv run --script` with inline dependencies
