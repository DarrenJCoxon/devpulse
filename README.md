# DevPulse

Real-time development dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Monitor multiple concurrent sessions across all your projects from a single browser tab.

## What it does

- **Live activity feed** — every tool call, prompt, and notification streamed in real-time via WebSocket
- **Project dashboard** — health scores, active sessions, current branches, and running dev servers per project
- **Auto-generated dev notes** — session summaries written automatically when sessions end
- **GitHub integration** — recent commits, open PRs, and CI status polled from the GitHub API
- **Vercel integration** — latest deployment status displayed per project
- **Sound alerts** — optional audio notifications for key events
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

**Option A — Always-on service (recommended)**

```bash
./scripts/service.sh install
```

This registers DevPulse as a macOS background service via launchd. Both the server and client auto-start on login and auto-restart if they crash — no terminal needed.

```bash
./scripts/service.sh status   # check both services are running
./scripts/service.sh logs      # tail log output
./scripts/service.sh stop      # stop temporarily (restarts on login)
./scripts/service.sh uninstall # remove the services entirely
```

**Option B — Manual (foreground)**

```bash
./scripts/start-system.sh
```

This starts two processes in the current terminal:
- **Server** on `http://localhost:4000` — receives events, stores in SQLite, broadcasts via WebSocket
- **Client** on `http://localhost:5173` — the dashboard UI

Wait for both "ready" messages before continuing. Press `Ctrl+C` to stop.

### Step 5: Add a project

1. Open **http://localhost:5173**
2. Click the **gear icon** in the header and choose **Add Project**
3. Enter the absolute path to your project and a display name
4. The wizard validates the path, shows a preview, then installs the hooks
5. Optionally send a test event to confirm everything is connected

Repeat for as many projects as you like.

### Step 6: Start coding

Open a terminal, `cd` into any hooked project, and run `claude`. Events stream into the dashboard in real-time.

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

## Adding & Removing Projects

Use the **Add Project** wizard in the dashboard (gear icon in the header). It validates the path, previews the changes, installs hooks, and lets you send a test event — all from the browser.

Alternatively, from the terminal:

```bash
./scripts/install-hooks.sh /absolute/path/to/project "ProjectName"
```

To remove hooks from a project:

```bash
rm -rf /path/to/project/.claude/hooks
mv /path/to/project/.claude/settings.json.backup /path/to/project/.claude/settings.json
```

---

## Stopping DevPulse

**If running as a service:**

```bash
./scripts/service.sh stop      # stop until next login
./scripts/service.sh uninstall # stop and remove completely
```

**If running in the foreground:**

Press `Ctrl+C` in the terminal, or run:

```bash
./scripts/reset-system.sh
```

This stops both processes and resets the database.

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

## Troubleshooting

### A project shows no activity even though Claude Code is running

Claude Code loads hooks from `.claude/settings.json` **when the session starts**. If you installed hooks while a session was already running, that session won't pick them up.

**Fix:** Restart the Claude session without losing context:

```bash
# In the terminal running Claude Code for that project:
claude --continue
```

This restarts the CLI process (reloading hooks) while preserving your full conversation history. The session ID stays the same, so DevPulse tracks it as a continuous session.

If the session was started with `--resume`, use that instead:

```bash
claude --resume
```

### A project shows "active" sessions but nothing is running

DevPulse marks sessions as idle after 2 minutes and stopped after 10 minutes of inactivity. If the server was restarted while sessions were mid-transition, the active count can get stuck. This self-corrects within 30 seconds as the reconciliation timer runs.

To force an immediate refresh, restart the server:

```bash
./scripts/start-system.sh
```

### Hooks are installed but events never arrive

1. **Check the server is running**: `curl http://localhost:4000/api/projects` should return JSON
2. **Test the hook manually** from your project directory:
   ```bash
   echo '{}' | uv run --script .claude/hooks/send_event.py --source-app YourProject --event-type PreToolUse
   ```
   If this errors, the hook scripts may be misconfigured or `uv` may not be installed.
3. **Check the hook files exist**: `ls .claude/hooks/send_event.py` in your project

---

## Credits

Extended from [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) by [IndyDevDan](https://www.youtube.com/@indydevdan). Watch the [deep dive on multi-agent orchestration](https://youtu.be/RpUTF_U4kiw) for background.
