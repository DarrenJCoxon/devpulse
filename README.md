# DevPulse

Real-time development dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Monitor multiple concurrent sessions across all your projects from a single browser tab.

<img src="images/app.png" alt="DevPulse Dashboard" style="max-width: 800px; width: 100%;">

## What it does

- **Live activity feed** — every tool call, prompt, and notification streamed in real-time via WebSocket
- **Project dashboard** — health scores, active sessions, current branches, and running dev servers per project
- **Auto-generated dev notes** — session summaries written automatically when sessions end
- **GitHub integration** — recent commits, open PRs, and CI status polled from the GitHub API
- **Vercel integration** — latest deployment status displayed per project
- **Sound alerts** — optional audio notifications for key events
- **Hook installer** — one command to wire up any project

Built on top of [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) by IndyDevDan.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- [Astral uv](https://docs.astral.sh/uv/) (for Python hook scripts)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed

### 1. Clone and install

```bash
git clone https://github.com/your-user/devPulse.git
cd devPulse
cd apps/server && bun install && cd ../client && bun install && cd ../..
```

### 2. Create `.env` (optional)

```bash
cp .env.sample .env
# Edit .env to add GitHub / Vercel tokens if you want those integrations
```

DevPulse works without any env vars — the integrations are optional.

### 3. Start the system

```bash
./scripts/start-system.sh
```

This launches the Bun server on **:4000** and the Vite dev server on **:5173**.

### 4. Install hooks in your projects

```bash
./scripts/install-hooks.sh /path/to/your/project "MyProject"
```

This copies the hook scripts and generates a `.claude/settings.json` in the target project. The `--source-app` flag is set to the project name you provide, so events appear labelled correctly in the dashboard.

### 5. Open the dashboard

Navigate to [http://localhost:5173](http://localhost:5173) and start a Claude Code session in any hooked project. Events stream in immediately.

## Environment Variables

All env vars are optional. Create a `.env` file at the project root (see `.env.sample`).

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope. Enables commit/PR/CI polling. |
| `GITHUB_REPOS` | JSON map of project name to `owner/repo` (e.g. `{"MyApp": "me/myapp"}`) |
| `VERCEL_API_TOKEN` | Vercel API token. Enables deployment status display. |
| `VERCEL_PROJECTS` | JSON map of project name to Vercel project ID |
| `VERCEL_TEAM_ID` | Vercel team/org ID (if projects belong to a team) |

The server loads `.env` from the project root via Bun's `--env-file` flag, so you only need one file regardless of where the server process runs.

## Adding Projects

### Via the install script

```bash
./scripts/install-hooks.sh ~/Code/my-api "MyAPI"
```

This:
1. Copies all hook scripts to `<project>/.claude/hooks/`
2. Generates `.claude/settings.json` with the project name baked in
3. Backs up any existing settings file

### Manually

Copy `.claude/hooks/send_event.py` to your project and add entries to your `.claude/settings.json` following the patterns in this repo's settings.

## Architecture

```
Claude Code Sessions
        |
        v
  Hook Scripts (Python/uv)
        |
        v
  HTTP POST /events
        |
        v
  Bun Server (SQLite WAL)
        |
        v
  WebSocket broadcast
        |
        v
  Vue 3 Dashboard
```

### Key files

| File | Purpose |
|---|---|
| `apps/server/src/index.ts` | HTTP/WebSocket server, all API routes |
| `apps/server/src/db.ts` | SQLite schema and queries |
| `apps/server/src/enricher.ts` | Event enrichment (git context, port scanning, test status) |
| `apps/server/src/github.ts` | GitHub API poller (commits, PRs, CI) |
| `apps/server/src/devlog.ts` | Auto-generated session dev notes |
| `apps/client/src/components/SimpleDashboard.vue` | Project cards with health scores |
| `apps/client/src/components/SimpleActivityFeed.vue` | Real-time event stream |
| `.claude/hooks/send_event.py` | Core hook — sends events to the server |
| `scripts/install-hooks.sh` | Hook installer for external projects |

### Database tables

- **events** — raw hook events
- **projects** — project status (branch, sessions, dev servers, test status, GitHub/Vercel status)
- **sessions** — session lifecycle tracking
- **dev_logs** — auto-generated session summaries

## Tech Stack

- **Server**: Bun, TypeScript, SQLite (WAL mode), `bun:sqlite`
- **Client**: Vue 3 (Composition API `<script setup>`), TypeScript, Vite, Tailwind CSS
- **Hooks**: Python 3.8+, Astral uv (inline script dependencies)
- **Communication**: HTTP REST + WebSocket

## Scripts

```bash
./scripts/start-system.sh    # Start server + client
./scripts/reset-system.sh    # Stop all processes and reset DB
./scripts/install-hooks.sh   # Install hooks in another project
```

## Credits

Extended from [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) by [IndyDevDan](https://www.youtube.com/@indydevdan). Watch the [deep dive on multi-agent orchestration](https://youtu.be/RpUTF_U4kiw) for background.
