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
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HookEvent, Project, Session, SessionStatus, TestStatus, DevLog, ProjectStatus, AgentNode } from './types';
import { parseBranchToTask } from './branch-parser';
import { initCosts, estimateTokensFromEvent, updateCostEstimate } from './costs';
import { initConflicts, trackFileAccess, cleanupOldFileAccess } from './conflicts';

let db: Database;

// Throttle health recalculation: only recalculate per project every 30 seconds
const healthCalcTimestamps = new Map<string, number>();
const HEALTH_CALC_THROTTLE_MS = 30_000;

export function initEnricher(database: Database): void {
  db = database;

  // Initialize cost tracking
  initCosts(database);

  // Initialize conflict tracking
  initConflicts(database);

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
      github_status TEXT DEFAULT '',
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

  // Migration: Add github_status column if it doesn't exist
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN github_status TEXT DEFAULT ''`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add health column if it doesn't exist (E5-S4)
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN health TEXT DEFAULT '{}'`);
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

  // Migration: Add topic column if it doesn't exist
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN topic TEXT DEFAULT ''`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add compaction tracking columns if they don't exist (E4-S3)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN compaction_count INTEGER DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN last_compaction_at INTEGER`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN compaction_history TEXT DEFAULT '[]'`);
  } catch {
    // Column already exists, ignore
  }

  // Create dev_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
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

  // Migrate existing dev_logs to add source_app column if needed
  try {
    const columns = db.prepare("PRAGMA table_info(dev_logs)").all() as any[];
    const hasSourceAppColumn = columns.some((col: any) => col.name === 'source_app');
    if (!hasSourceAppColumn) {
      db.exec('ALTER TABLE dev_logs ADD COLUMN source_app TEXT NOT NULL DEFAULT ""');
    }
  } catch (error) {
    // Table doesn't exist yet, CREATE TABLE above will handle it
  }

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

  // Create cost_estimates table (E4-S2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_estimates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      project_name TEXT NOT NULL,
      model_name TEXT NOT NULL,
      estimated_input_tokens INTEGER DEFAULT 0,
      estimated_output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      event_count INTEGER DEFAULT 0,
      calculated_at INTEGER NOT NULL,
      UNIQUE(session_id, source_app)
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_cost_estimates_project ON cost_estimates(project_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cost_estimates_calculated ON cost_estimates(calculated_at)');
}

// --- Project Health types and functions (E5-S4) ---

export interface ProjectHealth {
  score: number;           // 0-100
  testScore: number;       // 0-100
  activityScore: number;   // 0-100
  errorRateScore: number;  // 0-100
  trend: 'improving' | 'declining' | 'stable';
  previousScore: number;
}

/**
 * Calculate project health score from test status, session activity, and error rate.
 * Returns a score from 0-100 with component scores and trend.
 */
export function calculateProjectHealth(projectName: string): ProjectHealth {
  const now = Date.now();
  const thirtyMinutesAgo = now - 1800000; // 30 minutes

  // Get project data
  const project = db.prepare('SELECT test_status, health FROM projects WHERE name = ?').get(projectName) as any;

  if (!project) {
    return {
      score: 50,
      testScore: 50,
      activityScore: 30,
      errorRateScore: 100,
      trend: 'stable',
      previousScore: 50
    };
  }

  // 1. Test Status Score (40% weight)
  let testScore = 50; // unknown default
  switch (project.test_status) {
    case 'passing':
      testScore = 100;
      break;
    case 'failing':
      testScore = 0;
      break;
    default:
      testScore = 50;
  }

  // 2. Session Activity Score (30% weight)
  const sessionCounts = db.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
      COUNT(CASE WHEN status = 'idle' THEN 1 END) as idle,
      COUNT(*) as total
    FROM sessions
    WHERE project_name = ? AND status IN ('active', 'idle', 'waiting')
  `).get(projectName) as any;

  let activityScore = 30; // no sessions default
  if (sessionCounts.active > 0) {
    activityScore = 100;
  } else if (sessionCounts.idle > 0) {
    activityScore = 60;
  } else {
    activityScore = 30;
  }

  // 3. Error Rate Score (30% weight)
  // Query tool use events in the last 30 minutes
  const errorStats = db.prepare(`
    SELECT
      COUNT(CASE WHEN hook_event_type = 'PostToolUseFailure' THEN 1 END) as failures,
      COUNT(CASE WHEN hook_event_type IN ('PostToolUse', 'PostToolUseFailure') THEN 1 END) as total
    FROM events
    WHERE source_app = ? AND timestamp > ?
  `).get(projectName, thirtyMinutesAgo) as any;

  let errorRateScore = 100; // default: no errors
  if (errorStats.total > 0) {
    const errorRate = errorStats.failures / errorStats.total;
    // 0% errors = 100 score, 50% errors = 50 score, 100% errors = 0 score
    errorRateScore = Math.max(0, Math.round(100 - (errorRate * 100)));
  }

  // Calculate weighted score
  const score = Math.round(
    testScore * 0.4 +
    activityScore * 0.3 +
    errorRateScore * 0.3
  );

  // Determine trend based on previous score
  let previousScore = score;
  let trend: 'improving' | 'declining' | 'stable' = 'stable';

  try {
    const previousHealth = JSON.parse(project.health || '{}');
    if (previousHealth.score !== undefined) {
      previousScore = previousHealth.score;
      const diff = score - previousScore;
      if (diff > 5) {
        trend = 'improving';
      } else if (diff < -5) {
        trend = 'declining';
      }
    }
  } catch {
    // Failed to parse previous health, use defaults
  }

  return {
    score,
    testScore,
    activityScore,
    errorRateScore,
    trend,
    previousScore
  };
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

  // Track costs for this event
  try {
    const { input, output } = estimateTokensFromEvent(event);
    updateCostEstimate(sessionId, event.source_app, projectName, modelName, input, output);
  } catch (error) {
    console.error('[Costs] Error tracking event costs:', error);
  }

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
      // Stop fires after every Claude response (between turns), NOT only at session end.
      // Mark as waiting (agent finished responding, waiting for next user prompt).
      updateSessionStatus(sessionId, event.source_app, 'waiting', now);
      break;

    case 'Notification':
      // Agent is waiting for user input
      updateSessionStatus(sessionId, event.source_app, 'waiting', now);
      if (branch) updateSessionBranch(sessionId, event.source_app, branch);
      break;

    case 'UserPromptSubmit':
      // User responded, agent is active again — good time to detect branch changes
      updateSessionStatus(sessionId, event.source_app, 'active', now);
      if (branch) updateSessionBranch(sessionId, event.source_app, branch);
      // Capture topic from the first meaningful prompt
      captureSessionTopic(sessionId, event.source_app, event);
      break;

    case 'PreToolUse':
    case 'PostToolUse':
      // Agent is actively working
      updateSessionActivity(sessionId, event.source_app, now, branch);
      detectTestResults(event, projectName);
      detectDevServers(event, projectName);
      // Track file access for conflict detection (E4-S5)
      if (event.hook_event_type === 'PostToolUse') {
        trackFileAccessFromEvent(event, projectName);
      }
      break;

    case 'PostToolUseFailure':
      updateSessionActivity(sessionId, event.source_app, now, branch);
      break;

    case 'SubagentStart':
      handleSubagentStart(event, now);
      updateSessionActivity(sessionId, event.source_app, now, branch);
      break;

    case 'SubagentStop':
      handleSubagentStop(event, now);
      updateSessionActivity(sessionId, event.source_app, now, branch);
      break;

    case 'PreCompact':
      // Track context window compactions (E4-S3)
      handlePreCompact(sessionId, event.source_app, now);
      updateSessionActivity(sessionId, event.source_app, now, branch);
      break;

    default:
      updateSessionActivity(sessionId, event.source_app, now, branch);
      // Update topology last_event_at for any active topology node
      updateTopologyActivity(sessionId, event.source_app, now);
      break;
  }

  // Calculate and update health score for this project (E5-S4) - throttled to once per 30s per project
  const lastHealthCalc = healthCalcTimestamps.get(projectName) || 0;
  if (now - lastHealthCalc > HEALTH_CALC_THROTTLE_MS) {
    try {
      const health = calculateProjectHealth(projectName);
      db.prepare('UPDATE projects SET health = ?, updated_at = ? WHERE name = ?')
        .run(JSON.stringify(health), now, projectName);
      healthCalcTimestamps.set(projectName, now);
    } catch (error) {
      console.error('[Health] Error calculating project health:', error);
    }
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
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, deployment_status, github_status, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, 'unknown', '', '[]', '', '', ?, ?)
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

function updateSessionActivity(sessionId: string, sourceApp: string, now: number, branch?: string): void {
  // Set status back to 'active' — this handles the case where a Notification set it to 'waiting'
  // and the agent resumed working (tool use events arriving means it's active)
  db.prepare(
    "UPDATE sessions SET status = 'active', last_event_at = ?, event_count = event_count + 1 WHERE session_id = ? AND source_app = ? AND status != 'stopped'"
  ).run(now, sessionId, sourceApp);

  // Also ensure session exists (in case we missed SessionStart)
  const existing = db.prepare(
    'SELECT id FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(sessionId, sourceApp) as any;

  if (!existing) {
    upsertSession(sessionId, sourceApp, sourceApp, 'active', branch || '', now, '', '');
  }

  // Update branch + task_context if it changed
  if (branch) {
    updateSessionBranch(sessionId, sourceApp, branch);
  }
}

/**
 * Update a session's branch and task_context when the git branch changes.
 * Only writes to the DB if the branch actually differs from the stored value.
 */
function updateSessionBranch(sessionId: string, sourceApp: string, newBranch: string): void {
  const session = db.prepare(
    'SELECT current_branch FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(sessionId, sourceApp) as any;

  if (!session || session.current_branch === newBranch) return;

  const taskContext = parseBranchToTask(newBranch);
  db.prepare(
    'UPDATE sessions SET current_branch = ?, task_context = ? WHERE session_id = ? AND source_app = ?'
  ).run(newBranch, JSON.stringify(taskContext), sessionId, sourceApp);
}

/**
 * Capture the session's topic from the first UserPromptSubmit event.
 * Uses the AI summary if available, otherwise truncates the raw prompt.
 * Only sets the topic once — subsequent prompts don't overwrite it.
 */
function captureSessionTopic(sessionId: string, sourceApp: string, event: HookEvent): void {
  // Check if session already has a topic
  const session = db.prepare(
    'SELECT topic FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(sessionId, sourceApp) as any;

  if (session?.topic) return; // Already has a topic

  // Prefer the AI summary, fall back to raw prompt text
  let topic = event.summary || '';
  if (!topic) {
    const rawPrompt = event.payload?.prompt || '';
    if (typeof rawPrompt === 'string' && rawPrompt.length > 0) {
      // Truncate to first sentence or 120 chars
      const firstLine = rawPrompt.split('\n')[0].trim();
      topic = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
    }
  }

  if (!topic) return;

  db.prepare(
    'UPDATE sessions SET topic = ? WHERE session_id = ? AND source_app = ?'
  ).run(topic, sessionId, sourceApp);
}

// --- Detection helpers ---

// Cache for git branch detection — avoids running git on every event
const branchCache = new Map<string, { branch: string; timestamp: number }>();
const BRANCH_CACHE_TTL = 15_000; // 15 seconds

/**
 * Detect the current git branch from a working directory.
 * Caches the result for 15 seconds per directory to avoid excessive git calls.
 */
function detectGitBranch(cwd: string): string {
  if (!cwd) return '';

  const cached = branchCache.get(cwd);
  if (cached && Date.now() - cached.timestamp < BRANCH_CACHE_TTL) {
    return cached.branch;
  }

  try {
    const result = Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const branch = result.stdout.toString().trim();
    if (branch && branch !== 'HEAD') {
      branchCache.set(cwd, { branch, timestamp: Date.now() });
      // Evict oldest entries if cache exceeds max size
      if (branchCache.size > 50) {
        let oldestKey = '';
        let oldestTime = Infinity;
        for (const [key, val] of branchCache) {
          if (val.timestamp < oldestTime) {
            oldestTime = val.timestamp;
            oldestKey = key;
          }
        }
        if (oldestKey) branchCache.delete(oldestKey);
      }
      return branch;
    }
  } catch {
    // Not a git repo or git not available — ignore
  }

  return '';
}

function extractBranch(event: HookEvent): string {
  const payload = event.payload || {};

  // First try payload-provided branch
  if (payload.branch) return payload.branch;
  if (payload.git_branch) return payload.git_branch;

  // Then actively detect from cwd
  const cwd = payload.cwd || '';
  if (cwd) return detectGitBranch(cwd);

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

  // Count events and build tool breakdown - only extract needed fields via json_extract
  const events = db.prepare(`
    SELECT
      hook_event_type,
      json_extract(payload, '$.tool_name') as tool_name,
      json_extract(payload, '$.tool_input.file_path') as file_path,
      json_extract(payload, '$.tool_input.path') as alt_path,
      json_extract(payload, '$.tool_input.command') as command
    FROM events
    WHERE session_id = ? AND source_app = ?
  `).all(sessionId, sourceApp) as any[];

  const toolBreakdown: Record<string, number> = {};
  const filesChanged = new Set<string>();
  const commits: string[] = [];

  for (const evt of events) {
    // Track tool usage
    const toolName = evt.tool_name || '';
    if (toolName) {
      toolBreakdown[toolName] = (toolBreakdown[toolName] || 0) + 1;
    }

    // Track files from Write/Edit/Read tool uses
    if (['Write', 'Edit', 'Read'].includes(toolName)) {
      const filePath = evt.file_path || evt.alt_path || '';
      if (filePath) filesChanged.add(filePath);
    }

    // Track git commits from Bash commands
    if (toolName === 'Bash') {
      const cmd = evt.command || '';
      if (/git\s+commit/.test(cmd)) {
        // Try simple -m "message" format first
        const simpleMatch = cmd.match(/-m\s+["'](.+?)["']/);
        if (simpleMatch) {
          commits.push(simpleMatch[1]);
        } else {
          // Handle heredoc format: -m "$(cat <<'EOF'\nActual message\n...\nEOF\n)"
          const heredocMatch = cmd.match(/<<['"]?EOF['"]?\s*\n([\s\S]*?)\n\s*EOF/);
          if (heredocMatch) {
            // Extract the first line as the commit message (before Co-Authored-By etc.)
            const lines = heredocMatch[1].trim().split('\n');
            const messageLine = lines[0]?.trim();
            if (messageLine && !messageLine.startsWith('Co-Authored')) {
              commits.push(messageLine);
            }
          }
        }
      }
    }
  }

  // Build summary from the last Stop/SessionEnd event's summary if available
  const lastEvent = db.prepare(
    "SELECT summary FROM events WHERE session_id = ? AND source_app = ? AND hook_event_type IN ('Stop', 'SessionEnd') ORDER BY timestamp DESC LIMIT 1"
  ).get(sessionId, sourceApp) as any;

  const branch = session.current_branch || 'main';
  const startedAt = session.started_at;
  const durationMinutes = Math.round((now - startedAt) / 60000);
  const summary = lastEvent?.summary || buildAutoSummary(toolBreakdown, filesChanged.size, commits.length, projectName, branch, filesChanged, commits, durationMinutes);

  db.prepare(`
    INSERT INTO dev_logs (session_id, source_app, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    sourceApp,
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

  // Write markdown dev note to the project's docs/dev-notes/ folder
  writeDevNoteMarkdown({
    projectName,
    branch,
    summary,
    filesChanged: [...filesChanged],
    commits,
    startedAt,
    endedAt: now,
    durationMinutes,
    eventCount: events.length,
    toolBreakdown,
    cwd: session.cwd,
  });
}

function buildAutoSummary(
  toolBreakdown: Record<string, number>,
  fileCount: number,
  commitCount: number,
  projectName: string,
  branch: string,
  filesChanged?: Set<string>,
  commits?: string[],
  durationMinutes?: number
): string {
  const writes = (toolBreakdown['Write'] || 0) + (toolBreakdown['Edit'] || 0);
  const newFiles = toolBreakdown['Write'] || 0;
  const edits = toolBreakdown['Edit'] || 0;
  const bashOps = toolBreakdown['Bash'] || 0;
  const searches = (toolBreakdown['Glob'] || 0) + (toolBreakdown['Grep'] || 0);
  const subagents = toolBreakdown['Task'] || 0;

  // Clean commit messages — these describe WHAT was done
  const cleanCommits = (commits || []).filter(c => {
    if (!c || c.trim().length < 3) return false;
    if (c.includes('$(cat') || c.includes('<<') || c.includes('EOF')) return false;
    if (c.startsWith('Co-Authored')) return false;
    return true;
  });

  // If we have commit messages, use them as the summary — they describe the actual work
  if (cleanCommits.length > 0) {
    return cleanCommits.join(' | ');
  }

  // Humanize the branch name for fallback summary
  const branchDisplay = branch
    .replace(/^[a-zA-Z]+\//, '')
    .replace(/^[\d.]+[-_]/, '')
    .replace(/^[A-Z]+-\d+[-_]/, '')
    .replace(/[-_]+/g, ' ')
    .trim() || branch;

  // No commits — build a descriptive fallback from file names and actions
  const parts: string[] = [];

  // Describe what was changed using actual file names
  if (filesChanged && filesChanged.size > 0) {
    const fileNames = [...filesChanged].map(f => {
      const segments = f.replace(/\\/g, '/').split('/');
      return segments[segments.length - 1] || f;
    });

    // Deduplicate filenames
    const unique = [...new Set(fileNames)];

    if (unique.length <= 3) {
      if (newFiles > 0 && edits > 0) {
        parts.push(`Created and edited ${unique.join(', ')}`);
      } else if (newFiles > 0) {
        parts.push(`Created ${unique.join(', ')}`);
      } else {
        parts.push(`Edited ${unique.join(', ')}`);
      }
    } else {
      // Show first 2-3 notable files + count
      const shown = unique.slice(0, 3).join(', ');
      const remaining = unique.length - 3;
      if (newFiles > 0 && edits > 0) {
        parts.push(`Created and edited ${shown} and ${remaining} more file${remaining !== 1 ? 's' : ''}`);
      } else {
        parts.push(`Edited ${shown} and ${remaining} more file${remaining !== 1 ? 's' : ''}`);
      }
    }
  } else if (writes === 0 && bashOps === 0 && searches > 0) {
    parts.push('Explored and reviewed the codebase');
  } else if (writes > 0) {
    if (newFiles > 0 && edits > 0) {
      parts.push(`Created ${newFiles} new file${newFiles > 1 ? 's' : ''} and edited ${edits} existing`);
    } else if (edits > 0) {
      parts.push(`Edited ${fileCount} file${fileCount !== 1 ? 's' : ''}`);
    } else {
      parts.push(`Created ${newFiles} new file${newFiles > 1 ? 's' : ''}`);
    }
  }

  if (subagents > 0) {
    parts.push(`delegated ${subagents} task${subagents > 1 ? 's' : ''} to sub-agents`);
  }

  if (parts.length === 0) {
    return `Brief review session on ${branchDisplay}`;
  }

  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  if (parts.length === 1) {
    return first;
  }
  return `${first}, ${parts.slice(1).join(', ')}`;
}

// --- Dev Note Markdown Writer ---

interface DevNoteData {
  projectName: string;
  branch: string;
  summary: string;
  filesChanged: string[];
  commits: string[];
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  eventCount: number;
  toolBreakdown: Record<string, number>;
  cwd: string;
}

/**
 * Write a VitePress-compatible markdown dev note to the project's docs/dev-notes/ folder.
 * Creates the directory if it doesn't exist. Silently fails if the project directory
 * is not accessible (e.g., hooks from a remote machine).
 */
function writeDevNoteMarkdown(data: DevNoteData): void {
  if (!data.cwd) return;

  // Validate cwd is under a known project path before writing
  const resolvedCwd = resolve(data.cwd);
  const knownProjects = db.prepare('SELECT path FROM projects WHERE path != ""').all() as Array<{ path: string }>;
  const isKnownProject = knownProjects.some(p => {
    const resolvedProjectPath = resolve(p.path);
    return resolvedCwd === resolvedProjectPath || resolvedCwd.startsWith(resolvedProjectPath + '/');
  });
  if (!isKnownProject) {
    console.warn(`[DevNote] Skipping write: cwd "${data.cwd}" is not under any known project path`);
    return;
  }

  try {
    const docsDir = join(data.cwd, 'docs', 'dev-notes');

    // Create docs/dev-notes/ if it doesn't exist
    if (!existsSync(docsDir)) {
      mkdirSync(docsDir, { recursive: true });
    }

    const startDate = new Date(data.startedAt);
    const endDate = new Date(data.endedAt);

    // File name: YYYY-MM-DD-HHmm-branch-slug.md
    const datePrefix = startDate.toISOString().slice(0, 10);
    const timePrefix = startDate.toISOString().slice(11, 16).replace(':', '');
    const branchSlug = data.branch
      .replace(/^[a-zA-Z]+\//, '')  // strip prefix like feature/
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const fileName = `${datePrefix}-${timePrefix}-${branchSlug}.md`;
    const filePath = join(docsDir, fileName);

    // Don't overwrite existing notes
    if (existsSync(filePath)) return;

    // Format time strings
    const timeStr = (d: Date) => d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // Humanize branch
    const branchDisplay = data.branch
      .replace(/^[a-zA-Z]+\//, '')
      .replace(/^[\d.]+[-_]/, '')
      .replace(/^[A-Z]+-\d+[-_]/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || data.branch;

    // Filter garbage commits
    const cleanCommits = data.commits.filter(c => {
      if (!c || c.trim().length < 3) return false;
      if (c.includes('$(cat') || c.includes('<<') || c.includes('EOF')) return false;
      if (c.startsWith('Co-Authored')) return false;
      return true;
    });

    // Extract just filenames (not full paths) and deduplicate
    const fileNames = [...new Set(data.filesChanged.map(f => {
      const parts = f.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1] || f;
    }))];

    // Build markdown content
    const lines: string[] = [];

    // VitePress frontmatter
    lines.push('---');
    lines.push(`title: "${branchDisplay}"`);
    lines.push(`date: ${startDate.toISOString()}`);
    lines.push(`project: ${data.projectName}`);
    lines.push(`branch: ${data.branch}`);
    lines.push(`duration: ${data.durationMinutes} minutes`);
    lines.push(`files_changed: ${fileNames.length}`);
    lines.push(`commits: ${cleanCommits.length}`);
    lines.push('---');
    lines.push('');

    // Heading
    lines.push(`# ${branchDisplay}`);
    lines.push('');

    // Meta line
    lines.push(`> **${dateStr}** | ${timeStr(startDate)} - ${timeStr(endDate)} | ${data.durationMinutes} min | ${data.eventCount} events`);
    lines.push('');

    // Summary
    if (data.summary) {
      lines.push(`## Summary`);
      lines.push('');
      lines.push(data.summary);
      lines.push('');
    }

    // Commits
    if (cleanCommits.length > 0) {
      lines.push(`## Commits`);
      lines.push('');
      for (const commit of cleanCommits) {
        lines.push(`- ${commit}`);
      }
      lines.push('');
    }

    // Files changed
    if (fileNames.length > 0) {
      lines.push(`## Files Changed`);
      lines.push('');
      // Show first 20, then summarize
      const shown = fileNames.slice(0, 20);
      for (const file of shown) {
        lines.push(`- \`${file}\``);
      }
      if (fileNames.length > 20) {
        lines.push(`- ...and ${fileNames.length - 20} more`);
      }
      lines.push('');
    }

    // Branch info
    lines.push('---');
    lines.push('');
    lines.push(`*Branch: \`${data.branch}\` | Project: ${data.projectName}*`);
    lines.push('');

    Bun.write(filePath, lines.join('\n'));
    console.log(`[DevNote] Written: ${filePath}`);
  } catch (error) {
    // Silently fail - writing dev notes is best-effort
    console.error('[DevNote] Error writing markdown:', error);
  }
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

// --- Compaction Tracking operations (E4-S3) ---

/**
 * Handle PreCompact event - track context window compactions.
 * Increments compaction_count, sets last_compaction_at, and maintains
 * compaction_history (last 20 timestamps).
 */
function handlePreCompact(sessionId: string, sourceApp: string, now: number): void {
  // Get current session data
  const session = db.prepare(
    'SELECT compaction_history FROM sessions WHERE session_id = ? AND source_app = ?'
  ).get(sessionId, sourceApp) as any;

  if (!session) {
    // Session doesn't exist yet, create it
    upsertSession(sessionId, sourceApp, sourceApp, 'active', '', now, '', '');
  }

  // Parse compaction_history
  let history: number[] = [];
  try {
    history = JSON.parse(session?.compaction_history || '[]');
  } catch {
    history = [];
  }

  // Append new timestamp and trim to last 20
  history.push(now);
  if (history.length > 20) {
    history = history.slice(-20);
  }

  // Update session with incremented count, new last_compaction_at, and updated history
  db.prepare(`
    UPDATE sessions
    SET compaction_count = compaction_count + 1,
        last_compaction_at = ?,
        compaction_history = ?
    WHERE session_id = ? AND source_app = ?
  `).run(now, JSON.stringify(history), sessionId, sourceApp);
}

// --- File Access Tracking (E4-S5) ---

/**
 * Track file access from PostToolUse events for conflict detection.
 */
function trackFileAccessFromEvent(event: HookEvent, projectName: string): void {
  const payload = event.payload || {};
  const toolName = payload.tool_name || '';

  // Only track Read, Write, Edit tools
  if (!['Read', 'Write', 'Edit'].includes(toolName)) return;

  // Extract file path
  const filePath = payload.tool_input?.file_path;
  if (!filePath) return;

  // Determine access type
  const accessType = (toolName === 'Write' || toolName === 'Edit') ? 'write' : 'read';

  // Track the access
  try {
    trackFileAccess(filePath, projectName, event.session_id, event.source_app, accessType);
  } catch (error) {
    console.error('[FileAccess] Error tracking file access:', error);
  }
}

// --- Query functions for API ---

export function getAllProjects(): Project[] {
  const projects = db.prepare(`
    SELECT id, name, path, current_branch, active_sessions, last_activity,
           test_status, test_summary, dev_servers, deployment_status, github_status, health,
           created_at, updated_at
    FROM projects
    ORDER BY last_activity DESC
  `).all() as any[];

  // Parse health JSON for each project
  return projects.map(p => ({
    ...p,
    health: p.health ? JSON.parse(p.health) : undefined
  })) as Project[];
}

export function getProjectByName(name: string): Project | null {
  const project = db.prepare(`
    SELECT id, name, path, current_branch, active_sessions, last_activity,
           test_status, test_summary, dev_servers, deployment_status, github_status, health,
           created_at, updated_at
    FROM projects
    WHERE name = ?
  `).get(name) as any;
  if (!project) return null;

  return {
    ...project,
    health: project.health ? JSON.parse(project.health) : undefined
  } as Project;
}

export function getActiveSessions(): Session[] {
  // Return all active/idle/waiting sessions, plus recently-stopped sessions (last 30 minutes)
  // so the client can show a complete picture of recent activity
  const thirtyMinutesAgo = Date.now() - 1800000;
  return db.prepare(
    "SELECT * FROM sessions WHERE status IN ('active', 'waiting', 'idle') OR (status = 'stopped' AND last_event_at > ?) ORDER BY last_event_at DESC"
  ).all(thirtyMinutesAgo) as Session[];
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
 * Mark idle/waiting sessions as stopped if they haven't had activity in the last 10 minutes.
 * This handles the case where a user kills a terminal without sending a Stop event.
 * Called periodically by the server.
 */
export function markIdleSessions(): void {
  const now = Date.now();
  const twoMinutesAgo = now - 120000;
  const tenMinutesAgo = now - 600000;

  // Step 1: Mark active sessions as idle after 2 minutes of inactivity
  db.prepare(
    "UPDATE sessions SET status = 'idle' WHERE status = 'active' AND last_event_at < ?"
  ).run(twoMinutesAgo);

  // Step 2: Mark idle/waiting sessions as stopped after 10 minutes of inactivity
  // This catches sessions where the terminal was killed without a Stop event
  const staleSessionsBefore = db.prepare(
    "SELECT session_id, source_app, project_name FROM sessions WHERE status IN ('idle', 'waiting') AND last_event_at < ?"
  ).all(tenMinutesAgo) as any[];

  if (staleSessionsBefore.length > 0) {
    db.prepare(
      "UPDATE sessions SET status = 'stopped' WHERE status IN ('idle', 'waiting') AND last_event_at < ?"
    ).run(tenMinutesAgo);

    // Generate dev logs for these stale sessions
    for (const stale of staleSessionsBefore) {
      try {
        generateDevLog(stale.session_id, stale.project_name, stale.source_app, now);
      } catch (error) {
        // Dev log generation is best-effort
        console.error('[Enricher] Error generating dev log for stale session:', error);
      }
    }
  }

  // Update project session counts for all affected projects
  const affected = db.prepare(
    "SELECT DISTINCT project_name FROM sessions WHERE (status = 'idle' AND last_event_at < ?) OR (status = 'stopped' AND last_event_at >= ? AND last_event_at < ?)"
  ).all(twoMinutesAgo, tenMinutesAgo, now) as any[];

  for (const row of affected) {
    updateProjectSessionCount(row.project_name);
    // Recalculate health for affected projects (E5-S4)
    try {
      const health = calculateProjectHealth(row.project_name);
      db.prepare('UPDATE projects SET health = ?, updated_at = ? WHERE name = ?')
        .run(JSON.stringify(health), now, row.project_name);
    } catch (error) {
      console.error('[Health] Error recalculating project health:', error);
    }
  }
}

/**
 * Refresh current_branch for all known projects by running `git rev-parse` on their paths.
 * This catches branch changes that happen between hook events (e.g. user switches branch
 * in the terminal before a new Claude Code session starts sending events).
 */
export function refreshProjectBranches(): void {
  const projects = db.prepare('SELECT name, path, current_branch FROM projects WHERE path != ""').all() as Array<{
    name: string; path: string; current_branch: string;
  }>;

  for (const project of projects) {
    const detectedBranch = detectGitBranch(project.path);
    if (detectedBranch && detectedBranch !== project.current_branch) {
      db.prepare('UPDATE projects SET current_branch = ?, updated_at = ? WHERE name = ?')
        .run(detectedBranch, Date.now(), project.name);

      // Also update any active/idle sessions for this project
      const taskContext = parseBranchToTask(detectedBranch);
      db.prepare(`
        UPDATE sessions SET current_branch = ?, task_context = ?
        WHERE project_name = ? AND status IN ('active', 'idle', 'waiting')
      `).run(detectedBranch, JSON.stringify(taskContext), project.name);
    }
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
 * Clean up old file access log entries and dismissed conflicts (older than 24 hours).
 */
export function cleanupOldFileAccessLogs(): void {
  cleanupOldFileAccess();
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
 * Only keeps servers that were previously event-detected for that project
 * AND are still responding. Does not blindly assign all scanned ports to all projects.
 */
function updateProjectDevServers(scannedPorts: Array<{port: number; type: string}>): void {
  const activePorts = new Set(scannedPorts.map(s => s.port));

  const projects = db.prepare('SELECT name, dev_servers FROM projects').all() as Array<{name: string; dev_servers: string}>;

  for (const project of projects) {
    let existingServers: Array<{port: number; type: string}> = [];
    try {
      existingServers = JSON.parse(project.dev_servers || '[]');
    } catch {}

    // Only keep servers that this project already knew about AND are still responding
    const stillActive = existingServers.filter(s => activePorts.has(s.port));

    const prev = JSON.stringify(existingServers);
    const next = JSON.stringify(stillActive);
    if (prev !== next) {
      db.prepare('UPDATE projects SET dev_servers = ?, updated_at = ? WHERE name = ?')
        .run(next, Date.now(), project.name);
    }
  }
}
