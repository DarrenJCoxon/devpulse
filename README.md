# DevPulse

Real-time development dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Monitor multiple concurrent sessions across all your projects from a single browser tab.

## What it does

- **Live activity feed** — every tool call, prompt, and notification streamed in real-time via WebSocket
- **Project dashboard** — health scores, active sessions, current branches, and running dev servers per project
- **Auto-generated dev notes** — session summaries written automatically when sessions end
- **GitHub integration** — recent commits, open PRs, and CI status polled from the GitHub API
- **Vercel integration** — latest deployment status displayed per project
- **Sound alerts** — optional audio notifications for key events
- **Hook installer** — one command to wire up any project

Built on top of [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) by IndyDevDan.

---

## Setup (step by step)

### Prerequisites

Install these before you start:

1. **[Bun](https://bun.sh/)** (v1.1+) — runtime for the server and client
2. **[Astral uv](https://docs.astral.sh/uv/)** — runs the Python hook scripts
3. **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — the CLI you're monitoring

### Step 1: Clone the repo

```bash
git clone https://github.com/DarrenJCoxon/devpulse.git
cd devpulse
```

### Step 2: Install dependencies

Run `bun install` in both the server and client directories:

```bash
cd apps/server && bun install
cd ../client && bun install
cd ../..
```

You should now be back in the project root.

### Step 3: Create your `.env` file (optional)

```bash
cp .env.sample .env
```

This creates a `.env` file at the project root. DevPulse works without any env vars — GitHub and Vercel integrations are optional. If you want them, edit `.env` and add your tokens (see [Environment Variables](#environment-variables) below).

### Step 4: Start DevPulse

```bash
./scripts/start-system.sh
```

This starts two processes:
- **Server** on `http://localhost:4000` — receives events, stores in SQLite, broadcasts via WebSocket
- **Client** on `http://localhost:5173` — the dashboard UI

Wait for both "ready" messages before continuing.

### Step 5: Install hooks in a project you want to monitor

From the DevPulse root, run:

```bash
./scripts/install-hooks.sh /absolute/path/to/your/project "ProjectName"
```

For example:

```bash
./scripts/install-hooks.sh ~/Code/my-api "MyAPI"
./scripts/install-hooks.sh ~/Code/react-app "ReactApp"
```

This does three things:
1. Creates `.claude/hooks/` in the target project with all the hook scripts
2. Generates `.claude/settings.json` configured to send events labelled with your project name
3. Backs up any existing `.claude/settings.json` to `.claude/settings.json.backup`

You can run this on as many projects as you like.

### Step 6: Open the dashboard and start coding

1. Open **http://localhost:5173** in your browser
2. Open a terminal, `cd` into any hooked project, and run `claude`
3. Events stream into the dashboard as Claude Code works

That's it. Every tool call, prompt, notification, and session event will appear in real-time.

---

## Environment Variables

All env vars are optional. Create a `.env` file at the project root by copying `.env.sample`.

### GitHub Integration

Shows recent commits, open PRs, and CI workflow status on your project cards.

1. Go to **https://github.com/settings/tokens** and create a **fine-grained personal access token**
2. Set **Repository access** to "Only select repositories" and pick the repos you want to monitor
3. Under **Permissions**, grant read-only access to: **Contents**, **Pull requests**, **Actions**
4. Copy the token and add it to `.env`:

```env
GITHUB_TOKEN=github_pat_your_token_here
GITHUB_REPOS={"MyProject": "owner/repo", "AnotherProject": "owner/repo2"}
```

The `GITHUB_REPOS` keys must match the project names you used in `install-hooks.sh`.

### Vercel Integration

Shows latest deployment status on your project cards.

1. Go to **https://vercel.com/account/tokens** and create a token with **Read Only** scope
2. Copy the token and add it to `.env`:

```env
VERCEL_API_TOKEN=your_vercel_token_here
VERCEL_PROJECTS={"MyProject": "prj_xxxxxxxxxxxx"}
```

To find your Vercel project ID, run `vercel ls` or check your project settings in the Vercel dashboard.

3. If your projects belong to a team, also set:

```env
VERCEL_TEAM_ID=team_xxxxxxxxxxxx
```

You can find your team ID in the Vercel dashboard URL or via the API.

---

## Adding More Projects

### Via the install script (recommended)

```bash
./scripts/install-hooks.sh ~/Code/my-api "MyAPI"
```

### Manually

If you prefer to set things up yourself:

1. Copy the hook scripts:
   ```bash
   cp -R /path/to/devpulse/.claude/hooks /path/to/your/project/.claude/hooks
   ```

2. Add hook entries to your project's `.claude/settings.json`, replacing `YourProjectName` with a unique name. See this repo's `.claude/settings.json` for the full configuration covering all 12 hook event types.

### Removing hooks from a project

Delete the hooks directory and restore the backup settings:

```bash
rm -rf /path/to/project/.claude/hooks
mv /path/to/project/.claude/settings.json.backup /path/to/project/.claude/settings.json
```

---

## Stopping DevPulse

```bash
./scripts/reset-system.sh
```

This stops both processes and resets the database. To stop without resetting, just press `Ctrl+C` in the terminal running `start-system.sh`.

---

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

## Credits

Extended from [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) by [IndyDevDan](https://www.youtube.com/@indydevdan). Watch the [deep dive on multi-agent orchestration](https://youtu.be/RpUTF_U4kiw) for background.
