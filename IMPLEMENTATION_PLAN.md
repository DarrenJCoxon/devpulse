# DevPulse Implementation Plan

## What This Is

DevPulse is a real-time monitoring dashboard for concurrent Claude Code sessions across multiple projects. It's built on top of [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) (757 stars, by IndyDevDan), which provides the hook event pipeline and basic event timeline. DevPulse adds project-level intelligence, automated dev logs, and infrastructure monitoring.

**Owner**: Darren Coxon  
**Location**: `/Users/darrencoxon/Documents/Codebases/current-projects/devpulse`  
**Target projects to monitor**: ClassForge, WhiteSpace, Bridge AI, client work

---

## What's Already Done

These files have been created or modified from the base repo:

### Server (Bun + TypeScript)

| File | Status | Description |
|------|--------|-------------|
| `apps/server/src/types.ts` | ✅ COMPLETE | Extended with Project, Session, DevLog, ProjectStatus, EnrichedEvent types |
| `apps/server/src/enricher.ts` | ✅ COMPLETE | Event enrichment engine: project tracking, session lifecycle, test detection, dev server detection, auto dev log generation on session end |
| `apps/server/src/index.ts` | ✅ COMPLETE | Integrated enricher, added `/api/projects`, `/api/sessions`, `/api/devlogs` endpoints, WebSocket broadcasts project/session updates |
| `apps/server/src/db.ts` | ✅ MODIFIED | Added `getDb()` export so enricher can access the database instance |

### Scripts

| File | Status | Description |
|------|--------|-------------|
| `scripts/install-hooks.sh` | ✅ COMPLETE | Installs DevPulse hooks into any project. Usage: `./scripts/install-hooks.sh /path/to/project ProjectName` |

### Client (Vue 3 + Tailwind)

| File | Status | Description |
|------|--------|-------------|
| `apps/client/src/components/ProjectOverview.vue` | ✅ COMPLETE | Project cards with live status, sessions, test results, dev servers |
| `apps/client/src/components/DevLogTimeline.vue` | ⚠️ PARTIAL | Created but truncated at ~80%. Needs completion |

### Documentation

| File | Status | Description |
|------|--------|-------------|
| `CLAUDE.md` | ✅ COMPLETE | Project-level Claude Code instructions |

---

## What Still Needs Building

### Phase 1: Core Dashboard (get it running)

**1.1 Complete DevLogTimeline.vue**
- File: `apps/client/src/components/DevLogTimeline.vue`
- The component was started but truncated. It needs:
  - The `toggleFiles()` function completed
  - `parsedToolBreakdown()`, `parsedFiles()`, `parsedCommits()` helper functions
  - `toolIcon()` helper (map tool names to emoji: Read→📖, Write→✏️, Edit→🔧, Bash→💻)
  - `formatDate()` helper
  - The component should show a filterable list of session summaries with expandable file lists and commit messages

**1.2 Add client-side types**
- File: `apps/client/src/types.ts` 
- Add Project, Session, DevLog interfaces matching the server types
- The existing file has HookEvent and TimeRange types — add the new ones alongside

**1.3 Create useProjects composable**
- File: `apps/client/src/composables/useProjects.ts`
- Connects to the existing WebSocket at `ws://localhost:4000/stream`
- Listens for `type: 'projects'` and `type: 'sessions'` messages (the server already sends these)
- Exposes reactive `projects`, `sessions`, and `devLogs` refs
- Also fetches dev logs via `GET /api/devlogs` on mount and periodically (every 30s)
- Pattern: follow the existing `useWebSocket.ts` composable style

**1.4 Update App.vue with tab navigation**
- File: `apps/client/src/App.vue`
- Add a tab bar below the header with 3 tabs: "Projects" | "Events" | "Dev Log"
- "Projects" tab shows `<ProjectOverview>` component
- "Events" tab shows the existing EventTimeline + LivePulseChart + AgentSwimLanes
- "Dev Log" tab shows `<DevLogTimeline>` component
- Default to "Projects" tab
- Wire up the `useProjects` composable and pass data to components

**1.5 Verify server compiles and runs**
- `cd apps/server && bun dev` should start without errors
- The enricher creates its tables on startup (projects, sessions, dev_logs)
- Test by POSTing a fake event: `curl -X POST http://localhost:4000/events -H 'Content-Type: application/json' -d '{"source_app":"TestProject","session_id":"test-123","hook_event_type":"SessionStart","payload":{"cwd":"/tmp/test","session_id":"test-123"}}'`
- Then check: `curl http://localhost:4000/api/projects` should return the test project
- And: `curl http://localhost:4000/api/sessions` should return the test session

### Phase 2: Polish & Reliability

**2.1 Session idle detection improvements**
- The enricher already marks sessions idle after 2 minutes of inactivity (via `setInterval` in index.ts)
- But the client needs to handle this gracefully — sessions should fade or change colour when idle
- Consider: broadcast a 'sessions_updated' WebSocket message when idle detection runs

**2.2 Dev log quality improvements**
- Current: `generateDevLog()` in enricher.ts builds a basic auto-summary from tool counts
- Better: If the Stop event includes a `summary` field (which the hook scripts can generate via `--summarize`), use that instead
- Even better: Add an option to call an LLM API to generate a proper session summary from the chat transcript
- This is optional and can be skipped for v1 — the auto-summary is functional

**2.3 Git branch enrichment via hooks**
- Currently the enricher tries to extract branch from the event payload, but the hook scripts don't send it
- Enhancement: modify `send_event.py` to run `git branch --show-current` in the project directory and include it in the payload
- Add to the `send_event.py` main() function before sending:
  ```python
  import subprocess
  try:
      branch = subprocess.check_output(['git', 'branch', '--show-current'], 
          cwd=input_data.get('cwd', '.'), text=True, timeout=2).strip()
      event_data['payload']['git_branch'] = branch
  except:
      pass
  ```

**2.4 Port scanning for dev servers**
- Current: detects ports from Bash command output when dev servers are started
- Enhancement: periodically scan common ports (3000-3010, 4000-4010, 5173, 8080, 8000) to detect running servers
- Add a `scanPorts()` function to the enricher that runs every 60 seconds
- Use Bun's `fetch` to try connecting to `http://localhost:{port}` with a short timeout
- Update project's `dev_servers` field with discovered ports

### Phase 3: Extended Features (future)

**3.1 Vercel deployment status**
- Poll Vercel API for deployment status of connected projects
- Requires: Vercel API token, project IDs
- Show deploy status (building/ready/error) on project cards
- Can use `GET https://api.vercel.com/v6/deployments?projectId=xxx&limit=1`

**3.2 Story/task layer**
- Map git branch names to stories/tasks (e.g. `feature/AUTH-123-login-flow` → "AUTH-123: Login Flow")
- Parse branch name patterns: `feature/`, `fix/`, `chore/` prefixes
- Show task context on project cards
- Optional: integrate with Linear, GitHub Issues, or Notion for task names

**3.3 Daily/weekly summary generation**
- Aggregate dev logs into daily/weekly reports
- "What did I work on this week across all projects?"
- Could use LLM to generate a narrative from the dev log entries

**3.4 Notification system**
- Desktop notifications when a session needs input (agent is waiting)
- Could use macOS `osascript` or `terminal-notifier`
- The Notification hook event already fires — just needs a client-side handler

---

## Project Structure (key files only)

```
devpulse/
├── CLAUDE.md                          # Claude Code project instructions
├── IMPLEMENTATION_PLAN.md             # This file
├── scripts/
│   ├── start-system.sh                # Start server + client
│   ├── reset-system.sh                # Stop everything, clear DB
│   └── install-hooks.sh               # Install hooks in a project ✅ NEW
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts               # HTTP/WS server with all routes ✅ MODIFIED
│   │   │   ├── db.ts                  # SQLite schema + queries ✅ MODIFIED
│   │   │   ├── enricher.ts            # Event enrichment engine ✅ NEW
│   │   │   ├── types.ts               # TypeScript interfaces ✅ MODIFIED
│   │   │   └── theme.ts               # Theme system (existing)
│   │   └── package.json
│   └── client/
│       ├── src/
│       │   ├── App.vue                # Main layout — NEEDS tab navigation
│       │   ├── types.ts               # Client types — NEEDS new types
│       │   ├── components/
│       │   │   ├── ProjectOverview.vue # Project cards ✅ NEW
│       │   │   ├── DevLogTimeline.vue  # Dev log view — NEEDS completion
│       │   │   ├── EventTimeline.vue   # Existing event stream
│       │   │   ├── LivePulseChart.vue  # Activity chart
│       │   │   └── ... (other existing)
│       │   └── composables/
│       │       ├── useProjects.ts      # Project/session state — NEEDS creation
│       │       ├── useWebSocket.ts     # WS connection (existing)
│       │       └── ... (other existing)
│       └── package.json
└── .claude/
    └── hooks/                         # Hook scripts (copied to target projects)
        ├── send_event.py              # Core event sender
        └── ... (other hooks)
```

---

## How to Use This Plan with Claude Code

Open the project in Claude Code:
```bash
cd /Users/darrencoxon/Documents/Codebases/current-projects/devpulse
claude
```

Then prompt with something like:
```
Read IMPLEMENTATION_PLAN.md and CLAUDE.md. Complete Phase 1 - start with 
task 1.1 (finish DevLogTimeline.vue), then 1.2 (client types), then 1.3 
(useProjects composable), then 1.4 (App.vue tabs). After each step, 
verify the server and client compile without errors.
```

Or tackle tasks individually:
```
Read IMPLEMENTATION_PLAN.md section 1.1. Complete the DevLogTimeline.vue 
component - it was started but truncated.
```

---

## Prerequisites

Before running DevPulse:

1. **Bun** — `curl -fsSL https://bun.sh/install | bash`
2. **Python 3.8+** — for hook scripts
3. **Astral uv** — `curl -LsSf https://astral.sh/uv/install.sh | sh` (runs Python hook scripts)
4. **Node.js 18+** — for Vite dev server

Install dependencies:
```bash
cd apps/server && bun install
cd apps/client && bun install
```

---

## Quick Test

After Phase 1 is complete:

1. Start server: `cd apps/server && bun dev`
2. Start client: `cd apps/client && bun dev`  
3. Open `http://localhost:5173` — should see Projects tab (empty)
4. Send test event:
   ```bash
   curl -X POST http://localhost:4000/events \
     -H 'Content-Type: application/json' \
     -d '{
       "source_app": "ClassForge",
       "session_id": "test-abc-123",
       "hook_event_type": "SessionStart",
       "payload": {"cwd": "/Users/darren/classforge", "session_id": "test-abc-123"}
     }'
   ```
5. Project card should appear in dashboard
6. Install hooks on a real project: `./scripts/install-hooks.sh ~/Documents/Codebases/classforge ClassForge`
7. Start Claude Code in that project and watch events flow in
