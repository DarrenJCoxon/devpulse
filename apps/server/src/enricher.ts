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
import type { HookEvent, Project, Session, SessionStatus, TestStatus, DevLog, ProjectStatus } from './types';
import { parseBranchToTask } from './branch-parser';

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
      deployment_status TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Migration: Add deployment_status column if it doesn't exist (safe for existing databases)
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN deployment_status TEXT DEFAULT ''`);
  } catch {
    // Column already exists, ignore
  }

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

  // Migration: Add task_context column if it doesn't exist (safe for existing databases)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN task_context TEXT DEFAULT ''`);
  } catch {
    // Column already exists, ignore
  }

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

  // Create agent_topology table (E4-S1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_topology (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      parent_id TEXT,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      project_name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      model_name TEXT DEFAULT '',
      started_at INTEGER NOT NULL,
      last_event_at INTEGER NOT NULL,
      UNIQUE(agent_id)
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dev_logs_project ON dev_logs(project_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dev_logs_ended ON dev_logs(ended_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_topology_agent_id ON agent_topology(agent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_topology_parent_id ON agent_topology(parent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_topology_project ON agent_topology(project_name)');
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

    case 'SubagentStart':
      handleSubagentStart(event, now);
      updateSessionActivity(sessionId, event.source_app, now);
      break;

    case 'SubagentStop':
      handleSubagentStop(event, now);
      updateSessionActivity(sessionId, event.source_app, now);
      break;

    default:
      updateSessionActivity(sessionId, event.source_app, now);
      // Update topology last_event_at for any active topology node
      updateTopologyActivity(sessionId, event.source_app, now);
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
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, deployment_status, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, 'unknown', '', '[]', '', ?, ?)
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

  // Parse branch name into task context
  const normalizedBranch = branch || 'main';
  const taskContext = parseBranchToTask(normalizedBranch);
  const taskContextJson = JSON.stringify(taskContext);

  if (existing) {
    db.prepare(`
      UPDATE sessions SET status = ?, current_branch = ?, last_event_at = ?,
        model_name = CASE WHEN ? != '' THEN ? ELSE model_name END,
        cwd = CASE WHEN ? != '' THEN ? ELSE cwd END,
        task_context = ?
      WHERE session_id = ? AND source_app = ?
    `).run(status, normalizedBranch, now, modelName, modelName, cwd, cwd, taskContextJson, sessionId, sourceApp);
  } else {
    db.prepare(`
      INSERT INTO sessions (session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd, task_context)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(sessionId, projectName, sourceApp, status, normalizedBranch, now, now, modelName, cwd, taskContextJson);
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
  if (existing >= 0 && servers[existing]) {
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

  const branch = session.current_branch || 'main';
  const summary = lastEvent?.summary || buildAutoSummary(toolBreakdown, filesChanged.size, commits.length, projectName, branch);

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

function buildAutoSummary(
  toolBreakdown: Record<string, number>,
  fileCount: number,
  commitCount: number,
  projectName: string,
  branch: string
): string {
  const parts: string[] = [];

  const writes = (toolBreakdown['Write'] || 0) + (toolBreakdown['Edit'] || 0);
  const reads = toolBreakdown['Read'] || 0;
  const bashOps = toolBreakdown['Bash'] || 0;

  if (writes > 0) parts.push(`${writes} file edit${writes > 1 ? 's' : ''}`);
  if (reads > 0) parts.push(`${reads} file read${reads > 1 ? 's' : ''}`);
  if (bashOps > 0) parts.push(`${bashOps} command${bashOps > 1 ? 's' : ''}`);
  if (commitCount > 0) parts.push(`${commitCount} commit${commitCount > 1 ? 's' : ''}`);

  if (parts.length === 0) return `Brief session on ${projectName}/${branch}`;
  return `${parts.join(', ')} across ${fileCount} file${fileCount !== 1 ? 's' : ''} on ${branch}`;
}

// --- Agent Topology operations (E4-S1) ---

/**
 * Handle SubagentStart event - create topology record for child agent.
 */
function handleSubagentStart(event: HookEvent, now: number): void {
  const payload = event.payload || {};
  const childAgentId = payload.agent_id;

  if (!childAgentId) {
    console.warn('[Topology] SubagentStart missing agent_id in payload');
    return;
  }

  // Parent is the agent that spawned this subagent
  const parentAgentId = `${event.source_app}:${event.session_id}`;

  // Get project name from parent session
  const parentSession = db.prepare(
    'SELECT project_name, model_name FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(event.session_id, event.source_app) as any;

  const projectName = parentSession?.project_name || event.source_app;
  const modelName = event.model_name || parentSession?.model_name || '';

  // Insert or update topology record
  try {
    db.prepare(`
      INSERT INTO agent_topology (agent_id, parent_id, session_id, source_app, project_name, status, model_name, started_at, last_event_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        status = 'active',
        last_event_at = ?,
        model_name = CASE WHEN ? != '' THEN ? ELSE model_name END
    `).run(
      childAgentId,
      parentAgentId,
      childAgentId.split(':')[1] || '', // Extract session_id from agent_id
      childAgentId.split(':')[0] || '', // Extract source_app from agent_id
      projectName,
      modelName,
      now,
      now,
      now,
      modelName,
      modelName
    );
  } catch (error) {
    console.error('[Topology] Error inserting subagent:', error);
  }
}

/**
 * Handle SubagentStop event - mark child agent as stopped.
 */
function handleSubagentStop(event: HookEvent, now: number): void {
  const payload = event.payload || {};
  const childAgentId = payload.agent_id;

  if (!childAgentId) {
    console.warn('[Topology] SubagentStop missing agent_id in payload');
    return;
  }

  try {
    db.prepare(
      "UPDATE agent_topology SET status = 'stopped', last_event_at = ? WHERE agent_id = ?"
    ).run(now, childAgentId);
  } catch (error) {
    console.error('[Topology] Error stopping subagent:', error);
  }
}

/**
 * Update last_event_at for topology nodes on any event.
 */
function updateTopologyActivity(sessionId: string, sourceApp: string, now: number): void {
  const agentId = `${sourceApp}:${sessionId}`;

  try {
    db.prepare(
      'UPDATE agent_topology SET last_event_at = ? WHERE agent_id = ?'
    ).run(now, agentId);
  } catch (error) {
    // Silently fail if agent doesn't exist in topology (not all sessions are subagents)
  }
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

/**
 * Get agent topology tree, optionally filtered by project.
 * Returns a flat array of AgentNode objects with parent-child relationships.
 */
export function getAgentTopology(projectName?: string): AgentNode[] {
  let query = `
    SELECT
      t.agent_id,
      t.parent_id,
      t.status,
      t.model_name,
      t.project_name,
      t.started_at,
      t.last_event_at,
      s.task_context
    FROM agent_topology t
    LEFT JOIN sessions s ON t.session_id = s.session_id AND t.source_app = s.source_app
  `;

  const params: any[] = [];

  if (projectName) {
    query += ' WHERE t.project_name = ?';
    params.push(projectName);
  }

  query += ' ORDER BY t.started_at ASC';

  const rows = db.prepare(query).all(...params) as any[];

  // Build node map and tree structure
  const nodeMap = new Map<string, AgentNode>();

  for (const row of rows) {
    nodeMap.set(row.agent_id, {
      agent_id: row.agent_id,
      parent_id: row.parent_id,
      status: row.status,
      model_name: row.model_name,
      project_name: row.project_name,
      task_context: row.task_context || '',
      started_at: row.started_at,
      last_event_at: row.last_event_at,
      children: []
    });
  }

  // Populate children arrays
  for (const node of nodeMap.values()) {
    if (node.parent_id) {
      const parent = nodeMap.get(node.parent_id);
      if (parent) {
        parent.children.push(node.agent_id);
      }
    }
  }

  // Return flat array with populated children
  return Array.from(nodeMap.values());
}

// --- Port Scanning for Dev Servers ---

/**
 * Ports to scan for dev servers.
 * Covers common development ports across different frameworks.
 */
const SCAN_PORTS = [
  ...Array.from({length: 11}, (_, i) => 3000 + i),  // 3000-3010 (React, Express, etc.)
  ...Array.from({length: 11}, (_, i) => 4000 + i),  // 4000-4010 (Bun, custom)
  5173, 5174, 5175,                                   // Vite defaults
  8000, 8001, 8002,                                   // Python, misc
  8080, 8081, 8082,                                   // Java, misc
];

/**
 * Scan a single port to check if a dev server is running.
 * Uses a 1-second timeout to avoid hanging.
 */
async function scanSinglePort(port: number): Promise<{port: number; type: string} | null> {
  // Skip DevPulse's own server port
  const serverPort = parseInt(process.env.SERVER_PORT || '4000');
  if (port === serverPort) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    const response = await fetch(`http://localhost:${port}`, {
      signal: controller.signal,
      method: 'HEAD'
    });
    clearTimeout(timeout);

    // Consider any response that's not a server error as a running server
    if (response.ok || response.status < 500) {
      const type = detectServerType(response, port);
      return { port, type };
    }
  } catch {
    // Port not responding or connection refused - not a server
  }

  return null;
}

/**
 * Detect the type of server based on HTTP response headers and port number.
 */
function detectServerType(response: Response, port: number): string {
  const server = (response.headers.get('server') || '').toLowerCase();
  const powered = (response.headers.get('x-powered-by') || '').toLowerCase();

  // Check headers first
  if (server.includes('next') || powered.includes('next')) return 'next';
  if (server.includes('vite')) return 'vite';
  if (server.includes('nuxt')) return 'nuxt';

  // Fall back to port-based detection
  if (port === 5173 || port === 5174 || port === 5175) return 'vite';
  if (port >= 3000 && port <= 3010) return 'dev';
  if (port >= 4000 && port <= 4010) return 'bun';
  if (port >= 8000 && port <= 8002) return 'dev';
  if (port >= 8080 && port <= 8082) return 'dev';

  return 'dev';
}

/**
 * Scan all configured ports in parallel to detect running dev servers.
 * Updates projects with the detected servers.
 */
export async function scanPorts(): Promise<void> {
  const results = await Promise.allSettled(
    SCAN_PORTS.map(port => scanSinglePort(port))
  );

  const activeServers: Array<{port: number; type: string}> = [];

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      activeServers.push(result.value);
    }
  }

  // Update all projects with scan results
  updateProjectDevServers(activeServers);
}

/**
 * Update project dev_servers fields with scan results.
 * This merges scanned servers with event-detected servers.
 */
function updateProjectDevServers(servers: Array<{port: number; type: string}>): void {
  // Get all projects
  const projects = db.prepare('SELECT name, dev_servers FROM projects').all() as Array<{name: string; dev_servers: string}>;

  for (const project of projects) {
    // Parse existing servers
    let existingServers: Array<{port: number; type: string}> = [];
    try {
      existingServers = JSON.parse(project.dev_servers || '[]');
    } catch {}

    // Merge: keep event-detected servers, add/update with scan results
    const mergedServers = [...existingServers];

    for (const scannedServer of servers) {
      const existingIndex = mergedServers.findIndex(s => s.port === scannedServer.port);
      if (existingIndex >= 0 && mergedServers[existingIndex]) {
        // Update existing server type if scanned
        mergedServers[existingIndex].type = scannedServer.type;
      } else {
        // Add new scanned server
        mergedServers.push(scannedServer);
      }
    }

    // Remove servers that are no longer responding (not in scan results)
    const activeServers = mergedServers.filter(server =>
      servers.some(s => s.port === server.port)
    );

    // Update database
    db.prepare('UPDATE projects SET dev_servers = ?, updated_at = ? WHERE name = ?')
      .run(JSON.stringify(activeServers), Date.now(), project.name);
  }
}
