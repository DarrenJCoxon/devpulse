/**
 * DevPulse Event Enricher
 * 
 * Processes incoming hook events and enriches them with:
 * - Project identity (maps cwd/source_app to a project)
 * - Git context (branch, uncommitted files)
 * - Session tracking (start/stop/activity)
 * - Test status detection (from tool use events)
 * - Dev server detection (from tool use events scanning ports)
 */

import { Database } from 'bun:sqlite';
import type { HookEvent, Project, Session, SessionStatus, TestStatus } from './types';

let db: Database;

export function initEnricher(database: Database): void {
  db = database;

  // Create projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      current_branch TEXT DEFAULT 'main',
      active_sessions INTEGER DEFAULT 0,
      last_activity INTEGER NOT NULL,
      test_status TEXT DEFAULT 'unknown',
      test_summary TEXT DEFAULT '',
      dev_servers TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      source_app TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      current_branch TEXT DEFAULT 'main',
      started_at INTEGER NOT NULL,
      last_event_at INTEGER NOT NULL,
      event_count INTEGER DEFAULT 0,
      model_name TEXT DEFAULT '',
      cwd TEXT DEFAULT '',
      UNIQUE(session_id, source_app)
    )
  `);

  // Create dev_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      branch TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      files_changed TEXT DEFAULT '[]',
      commits TEXT DEFAULT '[]',
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_minutes REAL DEFAULT 0,
      event_count INTEGER DEFAULT 0,
      tool_breakdown TEXT DEFAULT '{}'
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dev_logs_project ON dev_logs(project_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dev_logs_ended ON dev_logs(ended_at)');
}

/**
 * Process an incoming hook event and update project/session state.
 * Called on every event received by the server.
 */
export function enrichEvent(event: HookEvent): void {
  const now = Date.now();
  const projectName = event.source_app;
  const sessionId = event.session_id;
  const cwd = event.payload?.cwd || '';
  const branch = extractBranch(event);
  const modelName = event.model_name || '';

  // Upsert project
  upsertProject(projectName, cwd, branch, now);

  // Handle session lifecycle
  switch (event.hook_event_type) {
    case 'SessionStart':
      upsertSession(sessionId, projectName, event.source_app, 'active', branch, now, modelName, cwd);
      updateProjectSessionCount(projectName);
      break;

    case 'SessionEnd':
      updateSessionStatus(sessionId, event.source_app, 'stopped', now);
      updateProjectSessionCount(projectName);
      generateDevLog(sessionId, projectName, event.source_app, now);
      break;

    case 'Stop':
      updateSessionStatus(sessionId, event.source_app, 'stopped', now);
      updateProjectSessionCount(projectName);
      generateDevLog(sessionId, projectName, event.source_app, now);
      break;

    case 'Notification':
      // Agent is waiting for user input
      updateSessionStatus(sessionId, event.source_app, 'waiting', now);
      break;

    case 'UserPromptSubmit':
      // User responded, agent is active again
      updateSessionStatus(sessionId, event.source_app, 'active', now);
      break;

    case 'PreToolUse':
    case 'PostToolUse':
      // Agent is actively working
      updateSessionActivity(sessionId, event.source_app, now);
      detectTestResults(event, projectName);
      detectDevServers(event, projectName);
      break;

    case 'PostToolUseFailure':
      updateSessionActivity(sessionId, event.source_app, now);
      break;

    default:
      updateSessionActivity(sessionId, event.source_app, now);
      break;
  }
}

// --- Project operations ---

function upsertProject(name: string, path: string, branch: string, now: number): void {
  const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(name) as any;

  if (existing) {
    const updates: string[] = ['last_activity = ?', 'updated_at = ?'];
    const params: any[] = [now, now];

    if (path) {
      updates.push('path = ?');
      params.push(path);
    }
    if (branch) {
      updates.push('current_branch = ?');
      params.push(branch);
    }

    params.push(name);
    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE name = ?`).run(...params);
  } else {
    db.prepare(`
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, 'unknown', '', '[]', ?, ?)
    `).run(name, path || '', branch || 'main', now, now, now);
  }
}

function updateProjectSessionCount(projectName: string): void {
  const result = db.prepare(
    "SELECT COUNT(*) as count FROM sessions WHERE project_name = ? AND status IN ('active', 'waiting', 'idle')"
  ).get(projectName) as any;

  db.prepare('UPDATE projects SET active_sessions = ?, updated_at = ? WHERE name = ?')
    .run(result?.count || 0, Date.now(), projectName);
}

// --- Session operations ---

function upsertSession(
  sessionId: string, projectName: string, sourceApp: string,
  status: SessionStatus, branch: string, now: number, modelName: string, cwd: string
): void {
  const existing = db.prepare(
    'SELECT id FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(sessionId, sourceApp) as any;

  if (existing) {
    db.prepare(`
      UPDATE sessions SET status = ?, current_branch = ?, last_event_at = ?,
        model_name = CASE WHEN ? != '' THEN ? ELSE model_name END,
        cwd = CASE WHEN ? != '' THEN ? ELSE cwd END
      WHERE session_id = ? AND source_app = ?
    `).run(status, branch || 'main', now, modelName, modelName, cwd, cwd, sessionId, sourceApp);
  } else {
    db.prepare(`
      INSERT INTO sessions (session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(sessionId, projectName, sourceApp, status, branch || 'main', now, now, modelName, cwd);
  }
}

function updateSessionStatus(sessionId: string, sourceApp: string, status: SessionStatus, now: number): void {
  db.prepare(
    'UPDATE sessions SET status = ?, last_event_at = ? WHERE session_id = ? AND source_app = ?'
  ).run(status, now, sessionId, sourceApp);
}

function updateSessionActivity(sessionId: string, sourceApp: string, now: number): void {
  db.prepare(
    'UPDATE sessions SET last_event_at = ?, event_count = event_count + 1 WHERE session_id = ? AND source_app = ?'
  ).run(now, sessionId, sourceApp);

  // Also ensure session exists (in case we missed SessionStart)
  const existing = db.prepare(
    'SELECT id FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(sessionId, sourceApp) as any;

  if (!existing) {
    upsertSession(sessionId, sourceApp, sourceApp, 'active', '', now, '', '');
  }
}

// --- Detection helpers ---

function extractBranch(event: HookEvent): string {
  // Try to get branch from payload cwd-based git detection
  // The hook scripts already run in the project directory
  const payload = event.payload || {};

  // Some hooks include git info in their payload
  if (payload.branch) return payload.branch;
  if (payload.git_branch) return payload.git_branch;

  return '';
}

/**
 * Detect test results from tool use events.
 * Looks for npm test, bun test, jest, vitest, pytest etc. in Bash commands.
 */
function detectTestResults(event: HookEvent, projectName: string): void {
  if (event.hook_event_type !== 'PostToolUse') return;

  const payload = event.payload || {};
  const toolName = payload.tool_name || event.payload?.tool_name;
  if (toolName !== 'Bash') return;

  const command = payload.tool_input?.command || '';
  const isTestCommand = /\b(test|jest|vitest|pytest|mocha|cypress)\b/i.test(command);
  if (!isTestCommand) return;

  // Try to parse test output from the tool result
  const output = payload.tool_result?.stdout || payload.output || '';
  let testStatus: TestStatus = 'unknown';
  let testSummary = '';

  // Common test output patterns
  const passMatch = output.match(/(\d+)\s+(?:tests?\s+)?passed/i);
  const failMatch = output.match(/(\d+)\s+(?:tests?\s+)?failed/i);
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed/i);
  const vitestMatch = output.match(/(\d+)\s+passed\s*(?:\|\s*(\d+)\s+failed)?/i);

  if (jestMatch) {
    const failed = parseInt(jestMatch[1] || '0');
    const passed = parseInt(jestMatch[2] || '0');
    testStatus = failed > 0 ? 'failing' : 'passing';
    testSummary = `${passed} passed${failed > 0 ? `, ${failed} failed` : ''}`;
  } else if (vitestMatch) {
    const passed = parseInt(vitestMatch[1] || '0');
    const failed = parseInt(vitestMatch[2] || '0');
    testStatus = failed > 0 ? 'failing' : 'passing';
    testSummary = `${passed} passed${failed > 0 ? `, ${failed} failed` : ''}`;
  } else if (passMatch || failMatch) {
    const passed = parseInt(passMatch?.[1] || '0');
    const failed = parseInt(failMatch?.[1] || '0');
    testStatus = failed > 0 ? 'failing' : (passed > 0 ? 'passing' : 'unknown');
    testSummary = `${passed} passed${failed > 0 ? `, ${failed} failed` : ''}`;
  }

  if (testStatus !== 'unknown') {
    db.prepare('UPDATE projects SET test_status = ?, test_summary = ?, updated_at = ? WHERE name = ?')
      .run(testStatus, testSummary, Date.now(), projectName);
  }
}

/**
 * Detect dev server starts from Bash commands.
 * Looks for next dev, vite, bun dev, npm run dev etc.
 */
function detectDevServers(event: HookEvent, projectName: string): void {
  if (event.hook_event_type !== 'PostToolUse') return;

  const payload = event.payload || {};
  const toolName = payload.tool_name || '';
  if (toolName !== 'Bash') return;

  const command = payload.tool_input?.command || '';
  const output = payload.tool_result?.stdout || payload.output || '';

  // Detect server start commands
  const isDevServer = /\b(next\s+dev|vite|bun\s+(run\s+)?dev|npm\s+run\s+dev|yarn\s+dev)\b/i.test(command);
  if (!isDevServer) return;

  // Try to extract port from output
  const portMatch = output.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/);
  if (!portMatch) return;

  const port = parseInt(portMatch[1]);
  let type = 'dev';
  if (/next/i.test(command)) type = 'next';
  else if (/vite/i.test(command)) type = 'vite';
  else if (/bun/i.test(command)) type = 'bun';

  // Get current servers and add/update
  const project = db.prepare('SELECT dev_servers FROM projects WHERE name = ?').get(projectName) as any;
  let servers: Array<{port: number; type: string}> = [];
  try {
    servers = JSON.parse(project?.dev_servers || '[]');
  } catch {}

  // Update or add
  const existing = servers.findIndex(s => s.port === port);
  if (existing >= 0) {
    servers[existing].type = type;
  } else {
    servers.push({ port, type });
  }

  db.prepare('UPDATE projects SET dev_servers = ?, updated_at = ? WHERE name = ?')
    .run(JSON.stringify(servers), Date.now(), projectName);
}

// --- Dev Log generation ---

/**
 * Generate a dev log entry when a session ends.
 * Aggregates session data into a summary.
 */
function generateDevLog(sessionId: string, projectName: string, sourceApp: string, now: number): void {
  // Get the session info
  const session = db.prepare(
    'SELECT * FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(sessionId, sourceApp) as any;

  if (!session) return;

  // Count events and build tool breakdown
  const events = db.prepare(
    "SELECT hook_event_type, payload FROM events WHERE session_id = ? AND source_app = ?"
  ).all(sessionId, sourceApp) as any[];

  const toolBreakdown: Record<string, number> = {};
  const filesChanged = new Set<string>();
  const commits: string[] = [];

  for (const evt of events) {
    let payload: any;
    try {
      payload = typeof evt.payload === 'string' ? JSON.parse(evt.payload) : evt.payload;
    } catch {
      continue;
    }

    // Track tool usage
    const toolName = payload?.tool_name || '';
    if (toolName) {
      toolBreakdown[toolName] = (toolBreakdown[toolName] || 0) + 1;
    }

    // Track files from Write/Edit/Read tool uses
    if (['Write', 'Edit', 'Read'].includes(toolName)) {
      const filePath = payload?.tool_input?.file_path || payload?.tool_input?.path || '';
      if (filePath) filesChanged.add(filePath);
    }

    // Track git commits from Bash commands
    if (toolName === 'Bash') {
      const cmd = payload?.tool_input?.command || '';
      if (/git\s+commit/.test(cmd)) {
        const msgMatch = cmd.match(/-m\s+["'](.+?)["']/);
        if (msgMatch) commits.push(msgMatch[1]);
      }
    }
  }

  // Build summary from the last Stop/SessionEnd event's summary if available
  const lastEvent = db.prepare(
    "SELECT summary FROM events WHERE session_id = ? AND source_app = ? AND hook_event_type IN ('Stop', 'SessionEnd') ORDER BY timestamp DESC LIMIT 1"
  ).get(sessionId, sourceApp) as any;

  const summary = lastEvent?.summary || buildAutoSummary(toolBreakdown, filesChanged.size, commits.length);

  const startedAt = session.started_at;
  const durationMinutes = Math.round((now - startedAt) / 60000);

  db.prepare(`
    INSERT INTO dev_logs (session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    projectName,
    session.current_branch || 'main',
    summary,
    JSON.stringify([...filesChanged]),
    JSON.stringify(commits),
    startedAt,
    now,
    durationMinutes,
    events.length,
    JSON.stringify(toolBreakdown)
  );
}

function buildAutoSummary(toolBreakdown: Record<string, number>, fileCount: number, commitCount: number): string {
  const parts: string[] = [];

  const writes = (toolBreakdown['Write'] || 0) + (toolBreakdown['Edit'] || 0);
  const reads = toolBreakdown['Read'] || 0;
  const bashOps = toolBreakdown['Bash'] || 0;

  if (writes > 0) parts.push(`${writes} file edit${writes > 1 ? 's' : ''}`);
  if (reads > 0) parts.push(`${reads} file read${reads > 1 ? 's' : ''}`);
  if (bashOps > 0) parts.push(`${bashOps} command${bashOps > 1 ? 's' : ''}`);
  if (commitCount > 0) parts.push(`${commitCount} commit${commitCount > 1 ? 's' : ''}`);

  if (parts.length === 0) return 'Brief session with minimal activity';
  return `Session: ${parts.join(', ')} across ${fileCount} file${fileCount !== 1 ? 's' : ''}`;
}

// --- Query functions for API ---

export function getAllProjects(): Project[] {
  return db.prepare('SELECT * FROM projects ORDER BY last_activity DESC').all() as Project[];
}

export function getProjectByName(name: string): Project | null {
  return db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as Project | null;
}

export function getActiveSessions(): Session[] {
  return db.prepare(
    "SELECT * FROM sessions WHERE status IN ('active', 'waiting', 'idle') ORDER BY last_event_at DESC"
  ).all() as Session[];
}

export function getSessionsForProject(projectName: string): Session[] {
  return db.prepare(
    'SELECT * FROM sessions WHERE project_name = ? ORDER BY last_event_at DESC LIMIT 20'
  ).all(projectName) as Session[];
}

export function getRecentDevLogs(limit: number = 50): DevLog[] {
  return db.prepare(
    'SELECT * FROM dev_logs ORDER BY ended_at DESC LIMIT ?'
  ).all(limit) as any[];
}

export function getDevLogsForProject(projectName: string, limit: number = 20): DevLog[] {
  return db.prepare(
    'SELECT * FROM dev_logs WHERE project_name = ? ORDER BY ended_at DESC LIMIT ?'
  ).all(projectName, limit) as any[];
}

export function getProjectStatus(projectName: string): ProjectStatus | null {
  const project = getProjectByName(projectName);
  if (!project) return null;

  return {
    project,
    sessions: getSessionsForProject(projectName),
    recent_logs: getDevLogsForProject(projectName, 10),
  };
}

/**
 * Mark sessions as idle if they haven't had activity in the last 2 minutes.
 * Called periodically by the server.
 */
export function markIdleSessions(): void {
  const twoMinutesAgo = Date.now() - 120000;
  db.prepare(
    "UPDATE sessions SET status = 'idle' WHERE status = 'active' AND last_event_at < ?"
  ).run(twoMinutesAgo);

  // Update project session counts for affected projects
  const affected = db.prepare(
    "SELECT DISTINCT project_name FROM sessions WHERE status = 'idle' AND last_event_at < ?"
  ).all(twoMinutesAgo) as any[];

  for (const row of affected) {
    updateProjectSessionCount(row.project_name);
  }
}

/**
 * Clean up old stopped sessions (older than 24 hours).
 */
export function cleanupOldSessions(): void {
  const oneDayAgo = Date.now() - 86400000;
  db.prepare("DELETE FROM sessions WHERE status = 'stopped' AND last_event_at < ?").run(oneDayAgo);
}
