import { initDatabase, getDb, insertEvent, getFilterOptions, getRecentEvents, updateEventHITLResponse, getEventsForSession, getSetting, setSetting, getAllSettings } from './db';
import {
  initEnricher, enrichEvent, getAllProjects, getActiveSessions,
  getProjectStatus, getRecentDevLogs, getDevLogsForProject,
  markIdleSessions, cleanupOldSessions, cleanupOldFileAccessLogs, scanPorts, getAgentTopology, refreshProjectBranches
} from './enricher';
import type { HookEvent, HumanInTheLoopResponse, Webhook } from './types';
import { triggerWebhooks, testWebhook, validateWebhookUrl } from './webhooks';
import {
  createTheme, updateThemeById, getThemeById, searchThemes,
  deleteThemeById, exportThemeById, importTheme, getThemeStats
} from './theme';
import { initVercelPoller } from './vercel';
import { initGitHubPoller } from './github';
import { initSummaries, getDailySummary, getWeeklySummary } from './summaries';
import { getCostsByProject, getCostsBySession, getDailyCosts } from './costs';
import { initMetrics, getSessionMetrics, getProjectMetrics } from './metrics';
import { getActiveConflicts, dismissConflict, detectConflicts } from './conflicts';
import { checkAlerts } from './alerts';
import { runCleanup, getAdminStats } from './retention';

// Initialize database and enricher
initDatabase();
initEnricher(getDb());
initVercelPoller(getDb());
initGitHubPoller(getDb());
initSummaries(getDb());
initMetrics(getDb());

// Mark idle sessions and check alerts every 30 seconds
setInterval(() => {
  markIdleSessions();
  refreshProjectBranches();
  broadcastProjects(); // Broadcast session updates to clients when idle/branch status changes
  broadcastAlerts(); // Check and broadcast alerts
}, 30000);

// Cleanup old sessions every hour
setInterval(() => {
  cleanupOldSessions();
  cleanupOldFileAccessLogs();
}, 3600000);

// Scan ports for dev servers every 60 seconds
setInterval(() => {
  scanPorts().then(() => broadcastProjects()).catch(console.error);
}, 60000);

// Initial port scan after 5 second delay (allow server to fully start)
setTimeout(() => {
  scanPorts().catch(console.error);
}, 5000);

// Cleanup old data based on retention settings (run daily by default)
function scheduleCleanup() {
  const settings = getAllSettings();
  const intervalHours = parseInt(settings['retention.cleanup.interval.hours'] || '24');
  const intervalMs = intervalHours * 3600000;

  setInterval(async () => {
    try {
      console.log('[Retention] Running scheduled cleanup...');
      const result = await runCleanup(getDb(), settings);
      console.log('[Retention] Cleanup complete:', result);
    } catch (error) {
      console.error('[Retention] Cleanup error:', error);
    }
  }, intervalMs);

  // Run initial cleanup after 1 hour
  setTimeout(async () => {
    try {
      console.log('[Retention] Running initial cleanup...');
      const result = await runCleanup(getDb(), settings);
      console.log('[Retention] Initial cleanup complete:', result);
    } catch (error) {
      console.error('[Retention] Initial cleanup error:', error);
    }
  }, 3600000);
}

scheduleCleanup();

// Store WebSocket clients
const wsClients = new Set<any>();

// Helper function to send response to agent via WebSocket
async function sendResponseToAgent(
  wsUrl: string,
  response: HumanInTheLoopResponse
): Promise<void> {
  console.log(`[HITL] Connecting to agent WebSocket: ${wsUrl}`);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isResolved = false;

    const cleanup = () => {
      if (ws) {
        try { ws.close(); } catch {}
      }
    };

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (isResolved) return;
        try {
          ws!.send(JSON.stringify(response));
          setTimeout(() => {
            cleanup();
            if (!isResolved) { isResolved = true; resolve(); }
          }, 500);
        } catch (error) {
          cleanup();
          if (!isResolved) { isResolved = true; reject(error); }
        }
      };

      ws.onerror = (error) => {
        cleanup();
        if (!isResolved) { isResolved = true; reject(error); }
      };

      ws.onclose = () => {};

      setTimeout(() => {
        if (!isResolved) {
          cleanup();
          isResolved = true;
          reject(new Error('Timeout sending response to agent'));
        }
      }, 5000);

    } catch (error) {
      cleanup();
      if (!isResolved) { isResolved = true; reject(error); }
    }
  });
}

// CORS headers
const CLIENT_ORIGIN = `http://localhost:${process.env.CLIENT_PORT || '5173'}`;
const headers = {
  'Access-Control-Allow-Origin': CLIENT_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };

// Server port constant
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '4000');

// Valid hook event types
const VALID_HOOK_EVENT_TYPES = new Set([
  'SessionStart', 'SessionEnd', 'Stop',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'UserPromptSubmit',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'TestHook',
]);

// Generate HTML report for export (E6-S2)
function generateHTMLReport(
  logs: any[],
  filters: { project?: string | null; sessionId?: string | null; from?: string | null; to?: string | null }
): string {
  const reportTitle = filters.project
    ? `DevPulse Report - ${filters.project}`
    : filters.sessionId
    ? `DevPulse Report - Session ${filters.sessionId.slice(0, 8)}`
    : 'DevPulse Report - All Projects';

  const generatedDate = new Date().toISOString();

  // Helper to parse JSON safely
  const parseJSON = (str: string | null, fallback: any) => {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  };

  // Helper to format duration
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // Calculate summary stats
  const totalSessions = logs.length;
  const totalDuration = logs.reduce((sum, log) => sum + log.duration_minutes, 0);
  const totalEvents = logs.reduce((sum, log) => sum + log.event_count, 0);
  const allFiles = new Set<string>();
  let totalCommits = 0;

  logs.forEach(log => {
    const files = parseJSON(log.files_changed, []);
    files.forEach((f: string) => allFiles.add(f));
    const commits = parseJSON(log.commits, []);
    totalCommits += commits.length;
  });

  // Generate log entries HTML
  const logsHTML = logs.map(log => {
    const files = parseJSON(log.files_changed, []);
    const commits = parseJSON(log.commits, []);
    const toolBreakdown = parseJSON(log.tool_breakdown, {});
    const toolEntries = Object.entries(toolBreakdown);

    const filesHTML = files.length > 0
      ? `<div class="section">
           <h4>Files Changed (${files.length})</h4>
           <div class="file-list">
             ${files.map((f: string) => `<code class="file-item">${escapeHTML(f)}</code>`).join('')}
           </div>
         </div>`
      : '';

    const commitsHTML = commits.length > 0
      ? `<div class="section">
           <h4>Commits</h4>
           <ul class="commit-list">
             ${commits.map((c: string) => `<li>${escapeHTML(c)}</li>`).join('')}
           </ul>
         </div>`
      : '';

    const toolsHTML = toolEntries.length > 0
      ? `<div class="section">
           <h4>Tool Usage</h4>
           <div class="tool-breakdown">
             ${toolEntries.map(([tool, count]) =>
               `<span class="tool-badge"><strong>${escapeHTML(tool)}</strong>: ${count}×</span>`
             ).join('')}
           </div>
         </div>`
      : '';

    return `
      <div class="log-card">
        <div class="log-header">
          <h3>${escapeHTML(log.project_name)} - ${escapeHTML(log.branch)}</h3>
          <div class="log-meta">
            <span><strong>Session:</strong> ${escapeHTML(log.session_id.slice(0, 8))}</span>
            <span><strong>Duration:</strong> ${formatDuration(log.duration_minutes)}</span>
            <span><strong>Events:</strong> ${log.event_count}</span>
            <span><strong>Completed:</strong> ${new Date(log.ended_at).toLocaleString()}</span>
          </div>
        </div>
        <div class="log-body">
          <div class="section">
            <h4>Summary</h4>
            <p>${escapeHTML(log.summary)}</p>
          </div>
          ${filesHTML}
          ${commitsHTML}
          ${toolsHTML}
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(reportTitle)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #1a202c;
      padding: 2rem;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }

    .report-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      text-align: center;
    }

    .report-header h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .report-header .generated {
      opacity: 0.9;
      font-size: 0.875rem;
    }

    .summary-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      padding: 2rem;
      background: #f7fafc;
      border-bottom: 1px solid #e2e8f0;
    }

    .stat-card {
      background: white;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      text-align: center;
    }

    .stat-card .label {
      font-size: 0.875rem;
      color: #718096;
      margin-bottom: 0.25rem;
    }

    .stat-card .value {
      font-size: 1.5rem;
      font-weight: bold;
      color: #667eea;
    }

    .logs-container {
      padding: 2rem;
    }

    .log-card {
      background: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }

    .log-header {
      background: white;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid #e2e8f0;
    }

    .log-header h3 {
      color: #2d3748;
      margin-bottom: 0.5rem;
    }

    .log-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      font-size: 0.875rem;
      color: #718096;
    }

    .log-body {
      padding: 1.5rem;
    }

    .section {
      margin-bottom: 1.5rem;
    }

    .section:last-child {
      margin-bottom: 0;
    }

    .section h4 {
      color: #4a5568;
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }

    .section p {
      color: #2d3748;
    }

    .file-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .file-item {
      background: white;
      border: 1px solid #e2e8f0;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
      color: #667eea;
    }

    .commit-list {
      list-style: none;
      padding-left: 0;
    }

    .commit-list li {
      color: #2d3748;
      padding: 0.25rem 0;
      padding-left: 1rem;
      position: relative;
    }

    .commit-list li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #667eea;
      font-weight: bold;
    }

    .tool-breakdown {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .tool-badge {
      background: white;
      border: 1px solid #e2e8f0;
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.875rem;
      color: #2d3748;
    }

    .tool-badge strong {
      color: #667eea;
    }

    .no-logs {
      text-align: center;
      padding: 4rem 2rem;
      color: #718096;
    }

    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="report-header">
      <h1>${escapeHTML(reportTitle)}</h1>
      <div class="generated">Generated: ${generatedDate}</div>
    </div>

    <div class="summary-stats">
      <div class="stat-card">
        <div class="label">Total Sessions</div>
        <div class="value">${totalSessions}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Duration</div>
        <div class="value">${formatDuration(totalDuration)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Events</div>
        <div class="value">${totalEvents}</div>
      </div>
      <div class="stat-card">
        <div class="label">Files Modified</div>
        <div class="value">${allFiles.size}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Commits</div>
        <div class="value">${totalCommits}</div>
      </div>
    </div>

    <div class="logs-container">
      ${logs.length > 0
        ? logsHTML
        : '<div class="no-logs"><p>No session logs found for the selected criteria.</p></div>'
      }
    </div>
  </div>
</body>
</html>`;
}

// Helper to escape HTML entities
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Create Bun server
const server = Bun.serve({
  port: SERVER_PORT,

  async fetch(req: Request) {
    const url = new URL(req.url);
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }
    
    // =============================================
    // EVENTS API (existing)
    // =============================================

    // POST /events - Receive new events
    if (url.pathname === '/events' && req.method === 'POST') {
      // Reject oversized payloads (5MB limit)
      const contentLength = parseInt(req.headers.get('content-length') || '0');
      if (contentLength > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Payload too large (max 5MB)' }), {
          status: 413, headers: jsonHeaders
        });
      }

      try {
        const event: HookEvent = await req.json();
        
        if (!event.source_app || !event.session_id || !event.hook_event_type || !event.payload) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Validate hook_event_type against allowlist
        if (!VALID_HOOK_EVENT_TYPES.has(event.hook_event_type)) {
          return new Response(JSON.stringify({ error: `Invalid hook_event_type: ${event.hook_event_type}` }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Insert event into database
        const savedEvent = insertEvent(event);
        
        // Enrich event (update projects, sessions, detect tests/servers)
        try {
          enrichEvent(event);
        } catch (err) {
          console.error('[Enricher] Error:', err);
        }

        // Trigger webhooks (fire and forget)
        triggerWebhooks(getDb(), savedEvent).catch(err => {
          console.error('[Webhook] Error:', err);
        });

        // Broadcast to WebSocket clients
        const message = JSON.stringify({ type: 'event', data: savedEvent });
        wsClients.forEach(client => {
          try { client.send(message); } catch { wsClients.delete(client); }
        });

        // Also broadcast updated project data
        broadcastProjects();

        // Broadcast topology updates for SubagentStart/SubagentStop events
        if (event.hook_event_type === 'SubagentStart' || event.hook_event_type === 'SubagentStop') {
          broadcastTopology();
        }

        // Broadcast conflicts if file access event (E4-S5)
        if (event.hook_event_type === 'PostToolUse') {
          const payload = event.payload || {};
          const toolName = payload.tool_name || '';
          if (['Read', 'Write', 'Edit'].includes(toolName)) {
            broadcastConflicts();
          }
        }

        // Broadcast dev logs when session ends (new dev note generated)
        if (event.hook_event_type === 'Stop' || event.hook_event_type === 'SessionEnd') {
          broadcastDevLogs();
        }

        return new Response(JSON.stringify(savedEvent), { headers: jsonHeaders });
      } catch (error) {
        console.error('Error processing event:', error);
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400, headers: jsonHeaders
        });
      }
    }
    
    // GET /events/filter-options
    if (url.pathname === '/events/filter-options' && req.method === 'GET') {
      return new Response(JSON.stringify(getFilterOptions()), { headers: jsonHeaders });
    }
    
    // GET /events/recent
    if (url.pathname === '/events/recent' && req.method === 'GET') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '300') || 300, 1000);
      return new Response(JSON.stringify(getRecentEvents(limit)), { headers: jsonHeaders });
    }

    // POST /events/:id/respond - HITL
    if (url.pathname.match(/^\/events\/\d+\/respond$/) && req.method === 'POST') {
      const id = parseInt(url.pathname.split('/')[2]);
      try {
        const response: HumanInTheLoopResponse = await req.json();
        response.respondedAt = Date.now();
        const updatedEvent = updateEventHITLResponse(id, response);

        if (!updatedEvent) {
          return new Response(JSON.stringify({ error: 'Event not found' }), {
            status: 404, headers: jsonHeaders
          });
        }

        if (updatedEvent.humanInTheLoop?.responseWebSocketUrl) {
          try {
            await sendResponseToAgent(updatedEvent.humanInTheLoop.responseWebSocketUrl, response);
          } catch (error) {
            console.error('Failed to send response to agent:', error);
          }
        }

        const message = JSON.stringify({ type: 'event', data: updatedEvent });
        wsClients.forEach(client => {
          try { client.send(message); } catch { wsClients.delete(client); }
        });

        return new Response(JSON.stringify(updatedEvent), { headers: jsonHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400, headers: jsonHeaders
        });
      }
    }

    // =============================================
    // DEVPULSE API (new)
    // =============================================

    // GET /api/projects - List all projects with status
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const projects = getAllProjects();
      return new Response(JSON.stringify(projects), { headers: jsonHeaders });
    }

    // GET /api/projects/:name - Get detailed project status
    if (url.pathname.match(/^\/api\/projects\/[^\/]+$/) && req.method === 'GET') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const status = getProjectStatus(name);
      if (!status) {
        return new Response(JSON.stringify({ error: 'Project not found' }), {
          status: 404, headers: jsonHeaders
        });
      }
      return new Response(JSON.stringify(status), { headers: jsonHeaders });
    }

    // GET /api/sessions - List active sessions
    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      const sessions = getActiveSessions();
      return new Response(JSON.stringify(sessions), { headers: jsonHeaders });
    }

    // GET /api/devlogs - Get recent dev logs
    if (url.pathname === '/api/devlogs' && req.method === 'GET') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 1000);
      const project = url.searchParams.get('project');

      const logs = project
        ? getDevLogsForProject(project, limit)
        : getRecentDevLogs(limit);

      return new Response(JSON.stringify(logs), { headers: jsonHeaders });
    }

    // GET /api/devnotes - List markdown dev notes from all project docs/dev-notes/ folders
    if (url.pathname === '/api/devnotes' && req.method === 'GET') {
      const { readdirSync, readFileSync, existsSync } = require('node:fs');
      const { join } = require('node:path');

      const projects = getAllProjects() as any[];
      const notes: { filename: string; project: string; content: string; path: string }[] = [];

      for (const project of projects) {
        if (!project.path) continue;
        const notesDir = join(project.path, 'docs', 'dev-notes');
        if (!existsSync(notesDir)) continue;

        try {
          const files = readdirSync(notesDir)
            .filter((f: string) => f.endsWith('.md'))
            .sort()
            .reverse(); // newest first

          for (const file of files.slice(0, 50)) {
            try {
              const content = readFileSync(join(notesDir, file), 'utf-8');
              notes.push({
                filename: file,
                project: project.name,
                content,
                path: join(notesDir, file),
              });
            } catch { /* skip unreadable files */ }
          }
        } catch { /* skip inaccessible directories */ }
      }

      // Sort all notes by filename (date-prefixed) descending
      notes.sort((a, b) => b.filename.localeCompare(a.filename));

      return new Response(JSON.stringify(notes.slice(0, 100)), { headers: jsonHeaders });
    }

    // GET /api/sessions/:sessionId/events - Get all events for a session
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/events$/) && req.method === 'GET') {
      const sessionId = decodeURIComponent(url.pathname.split('/')[3]);
      const sourceApp = url.searchParams.get('source_app');

      if (!sourceApp) {
        return new Response(JSON.stringify({ error: 'Missing source_app query parameter' }), {
          status: 400, headers: jsonHeaders
        });
      }

      const events = getEventsForSession(sessionId, sourceApp);
      return new Response(JSON.stringify(events), { headers: jsonHeaders });
    }

    // GET /api/topology - Get agent topology tree (E4-S1)
    if (url.pathname === '/api/topology' && req.method === 'GET') {
      const project = url.searchParams.get('project');
      const topology = getAgentTopology(project || undefined);
      return new Response(JSON.stringify(topology), { headers: jsonHeaders });
    }

    // GET /api/summaries - Get daily or weekly summaries
    if (url.pathname === '/api/summaries' && req.method === 'GET') {
      const period = url.searchParams.get('period');

      // Validate period parameter
      if (!period || !['daily', 'weekly'].includes(period)) {
        return new Response(JSON.stringify({ error: 'Invalid period. Must be "daily" or "weekly"' }), {
          status: 400, headers: jsonHeaders
        });
      }

      try {
        if (period === 'daily') {
          const date = url.searchParams.get('date');
          if (!date) {
            return new Response(JSON.stringify({ error: 'Missing date parameter (YYYY-MM-DD)' }), {
              status: 400, headers: jsonHeaders
            });
          }

          // Validate date format
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return new Response(JSON.stringify({ error: 'Invalid date format. Expected YYYY-MM-DD' }), {
              status: 400, headers: jsonHeaders
            });
          }

          const summary = getDailySummary(date);
          return new Response(JSON.stringify(summary), { headers: jsonHeaders });
        } else {
          // Weekly
          const week = url.searchParams.get('week');
          if (!week) {
            return new Response(JSON.stringify({ error: 'Missing week parameter (YYYY-Www)' }), {
              status: 400, headers: jsonHeaders
            });
          }

          // Validate ISO week format
          if (!/^\d{4}-W\d{2}$/.test(week)) {
            return new Response(JSON.stringify({ error: 'Invalid week format. Expected YYYY-Www (e.g., 2026-W07)' }), {
              status: 400, headers: jsonHeaders
            });
          }

          const summary = getWeeklySummary(week);
          return new Response(JSON.stringify(summary), { headers: jsonHeaders });
        }
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/costs - Get cost estimates (E4-S2)
    if (url.pathname === '/api/costs' && req.method === 'GET') {
      const group = url.searchParams.get('group');

      if (!group) {
        return new Response(JSON.stringify({ error: 'Missing group parameter. Must be "project", "session", or "daily"' }), {
          status: 400, headers: jsonHeaders
        });
      }

      try {
        if (group === 'project') {
          // Optional date range
          const startDate = url.searchParams.get('startDate');
          const endDate = url.searchParams.get('endDate');

          const costs = getCostsByProject(
            startDate ? parseInt(startDate) : undefined,
            endDate ? parseInt(endDate) : undefined
          );

          return new Response(JSON.stringify(costs), { headers: jsonHeaders });
        } else if (group === 'session') {
          const project = url.searchParams.get('project');
          if (!project) {
            return new Response(JSON.stringify({ error: 'Missing project parameter for session grouping' }), {
              status: 400, headers: jsonHeaders
            });
          }

          const costs = getCostsBySession(project);
          return new Response(JSON.stringify(costs), { headers: jsonHeaders });
        } else if (group === 'daily') {
          const daysParam = url.searchParams.get('days');
          const days = daysParam ? parseInt(daysParam) : 7;

          if (isNaN(days) || days < 1 || days > 365) {
            return new Response(JSON.stringify({ error: 'Invalid days parameter. Must be between 1 and 365' }), {
              status: 400, headers: jsonHeaders
            });
          }

          const costs = getDailyCosts(days);
          return new Response(JSON.stringify(costs), { headers: jsonHeaders });
        } else {
          return new Response(JSON.stringify({ error: 'Invalid group parameter. Must be "project", "session", or "daily"' }), {
            status: 400, headers: jsonHeaders
          });
        }
      } catch (error: any) {
        console.error('[Costs API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/metrics - Get agent performance metrics (E4-S4)
    if (url.pathname === '/api/metrics' && req.method === 'GET') {
      const group = url.searchParams.get('group');

      if (!group) {
        return new Response(JSON.stringify({ error: 'Missing group parameter. Must be "session" or "project"' }), {
          status: 400, headers: jsonHeaders
        });
      }

      try {
        // Parse optional date range filters
        const startParam = url.searchParams.get('start');
        const endParam = url.searchParams.get('end');
        const startTimestamp = startParam ? parseInt(startParam) : undefined;
        const endTimestamp = endParam ? parseInt(endParam) : undefined;

        if (group === 'session') {
          const project = url.searchParams.get('project');
          if (!project) {
            return new Response(JSON.stringify({ error: 'Missing project parameter for session grouping' }), {
              status: 400, headers: jsonHeaders
            });
          }

          // Get all sessions for the project, filtered by date range
          let sql = 'SELECT session_id, source_app FROM sessions WHERE project_name = ?';
          const params: any[] = [project];

          if (startTimestamp !== undefined) {
            sql += ' AND started_at >= ?';
            params.push(startTimestamp);
          }

          if (endTimestamp !== undefined) {
            sql += ' AND started_at <= ?';
            params.push(endTimestamp);
          }

          const sessionsStmt = getDb().prepare(sql);
          const sessionRows = sessionsStmt.all(...params) as any[];

          // Compute metrics for each session
          const sessionMetrics = sessionRows
            .map(row => getSessionMetrics(row.session_id, row.source_app, startTimestamp, endTimestamp))
            .filter(m => m !== null);

          return new Response(JSON.stringify(sessionMetrics), { headers: jsonHeaders });
        } else if (group === 'project') {
          // Optional project filter
          const project = url.searchParams.get('project');
          const projectMetrics = getProjectMetrics(project || undefined, startTimestamp, endTimestamp);

          return new Response(JSON.stringify(projectMetrics), { headers: jsonHeaders });
        } else {
          return new Response(JSON.stringify({ error: 'Invalid group parameter. Must be "session" or "project"' }), {
            status: 400, headers: jsonHeaders
          });
        }
      } catch (error: any) {
        console.error('[Metrics API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/conflicts - Get active conflicts (E4-S5)
    if (url.pathname === '/api/conflicts' && req.method === 'GET') {
      try {
        const windowMinutes = parseInt(url.searchParams.get('window') || '30');
        const conflicts = getActiveConflicts(windowMinutes);
        return new Response(JSON.stringify(conflicts), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Conflicts API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/search - Full-text search across events, sessions, dev_logs (E6-S3)
    if (url.pathname === '/api/search' && req.method === 'GET') {
      try {
        const query = url.searchParams.get('q');
        const type = url.searchParams.get('type') || 'all';
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam) : 20;

        if (!query || query.trim() === '') {
          return new Response(JSON.stringify({ error: 'Missing query parameter (q)' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Validate type parameter
        const validTypes = ['events', 'sessions', 'devlogs', 'all'];
        if (!validTypes.includes(type)) {
          return new Response(JSON.stringify({ error: 'Invalid type parameter. Must be one of: events, sessions, devlogs, all' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Validate limit parameter
        if (isNaN(limit) || limit < 1 || limit > 100) {
          return new Response(JSON.stringify({ error: 'Invalid limit parameter. Must be between 1 and 100' }), {
            status: 400, headers: jsonHeaders
          });
        }

        const searchTerm = `%${query}%`;
        const results: {
          events: { count: number; results: HookEvent[] };
          sessions: { count: number; results: Session[] };
          devlogs: { count: number; results: DevLog[] };
        } = {
          events: { count: 0, results: [] },
          sessions: { count: 0, results: [] },
          devlogs: { count: 0, results: [] }
        };

        // Search events
        if (type === 'events' || type === 'all') {
          const eventsCountStmt = getDb().prepare(`
            SELECT COUNT(*) as count FROM events
            WHERE payload LIKE ? OR summary LIKE ? OR source_app LIKE ?
          `);
          const eventsCount = eventsCountStmt.get(searchTerm, searchTerm, searchTerm) as { count: number };
          results.events.count = eventsCount.count;

          const eventsStmt = getDb().prepare(`
            SELECT id, source_app, session_id, hook_event_type, payload, chat, summary, timestamp, model_name
            FROM events
            WHERE payload LIKE ? OR summary LIKE ? OR source_app LIKE ?
            ORDER BY timestamp DESC LIMIT ?
          `);
          results.events.results = eventsStmt.all(searchTerm, searchTerm, searchTerm, limit) as HookEvent[];
        }

        // Search sessions
        if (type === 'sessions' || type === 'all') {
          const sessionsCountStmt = getDb().prepare(`
            SELECT COUNT(*) as count FROM sessions
            WHERE session_id LIKE ?
               OR source_app LIKE ?
               OR project_name LIKE ?
               OR current_branch LIKE ?
          `);
          const sessionsCount = sessionsCountStmt.get(searchTerm, searchTerm, searchTerm, searchTerm) as { count: number };
          results.sessions.count = sessionsCount.count;

          const sessionsStmt = getDb().prepare(`
            SELECT id, session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd, task_context, compaction_count, last_compaction_at, compaction_history
            FROM sessions
            WHERE session_id LIKE ?
               OR source_app LIKE ?
               OR project_name LIKE ?
               OR current_branch LIKE ?
            ORDER BY last_event_at DESC LIMIT ?
          `);
          results.sessions.results = sessionsStmt.all(searchTerm, searchTerm, searchTerm, searchTerm, limit) as Session[];
        }

        // Search dev logs
        if (type === 'devlogs' || type === 'all') {
          const devlogsCountStmt = getDb().prepare(`
            SELECT COUNT(*) as count FROM dev_logs
            WHERE summary LIKE ?
               OR files_changed LIKE ?
               OR project_name LIKE ?
          `);
          const devlogsCount = devlogsCountStmt.get(searchTerm, searchTerm, searchTerm) as { count: number };
          results.devlogs.count = devlogsCount.count;

          const devlogsStmt = getDb().prepare(`
            SELECT id, session_id, source_app, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown
            FROM dev_logs
            WHERE summary LIKE ?
               OR files_changed LIKE ?
               OR project_name LIKE ?
            ORDER BY ended_at DESC LIMIT ?
          `);
          results.devlogs.results = devlogsStmt.all(searchTerm, searchTerm, searchTerm, limit) as DevLog[];
        }

        return new Response(JSON.stringify(results), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Search API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/analytics/heatmap - Get activity heatmap data (E6-S1)
    if (url.pathname === '/api/analytics/heatmap' && req.method === 'GET') {
      try {
        const daysParam = url.searchParams.get('days');
        const days = daysParam ? parseInt(daysParam) : 30;
        const project = url.searchParams.get('project');

        // Validate days parameter
        if (isNaN(days) || days < 1 || days > 365) {
          return new Response(JSON.stringify({ error: 'Invalid days parameter. Must be between 1 and 365' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Calculate timestamp threshold
        const now = Date.now();
        const threshold = now - (days * 86400000);

        // Build SQL query
        let sql = `
          SELECT
            date(timestamp/1000, 'unixepoch', 'localtime') as day,
            CAST(strftime('%H', timestamp/1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
            COUNT(*) as count
          FROM events
          WHERE timestamp > ?
        `;
        const params: any[] = [threshold];

        // Add optional project filter
        if (project && project !== 'all') {
          sql += ' AND source_app = ?';
          params.push(project);
        }

        sql += ' GROUP BY day, hour ORDER BY day, hour';

        // Execute query
        const stmt = getDb().prepare(sql);
        const rows = stmt.all(...params) as any[];

        // Transform to cells array and find max count
        const cells = rows.map(row => ({
          day: row.day,
          hour: row.hour,
          count: row.count
        }));

        const maxCount = rows.length > 0 ? Math.max(...rows.map(r => r.count)) : 0;

        return new Response(JSON.stringify({ cells, maxCount }), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Heatmap API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/export/report - Generate HTML report (E6-S2)
    if (url.pathname === '/api/export/report' && req.method === 'GET') {
      try {
        const project = url.searchParams.get('project');
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const sessionId = url.searchParams.get('sessionId');

        // Build query to fetch dev logs
        let sql = 'SELECT * FROM dev_logs WHERE 1=1';
        const params: any[] = [];

        // Filter by project
        if (project && project !== 'all') {
          sql += ' AND project_name = ?';
          params.push(project);
        }

        // Filter by session
        if (sessionId) {
          sql += ' AND session_id = ?';
          params.push(sessionId);
        }

        // Filter by date range
        if (fromParam) {
          const fromTimestamp = parseInt(fromParam);
          if (!isNaN(fromTimestamp)) {
            sql += ' AND ended_at >= ?';
            params.push(fromTimestamp);
          }
        }

        if (toParam) {
          const toTimestamp = parseInt(toParam);
          if (!isNaN(toTimestamp)) {
            sql += ' AND ended_at <= ?';
            params.push(toTimestamp);
          }
        }

        sql += ' ORDER BY ended_at DESC';

        const stmt = getDb().prepare(sql);
        const logs = stmt.all(...params) as any[];

        // Generate HTML report
        const html = generateHTMLReport(logs, {
          project,
          sessionId,
          from: fromParam,
          to: toParam
        });

        return new Response(html, {
          headers: {
            ...headers,
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': `attachment; filename="devpulse-report-${Date.now()}.html"`
          }
        });
      } catch (error: any) {
        console.error('[Export Report API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // POST /api/validate-path - Validate project path (E5-S5)
    if (url.pathname === '/api/validate-path' && req.method === 'POST') {
      try {
        const body = await req.json() as { path?: string };
        const { path } = body;

        if (!path) {
          return new Response(JSON.stringify({ error: 'Missing path parameter' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Check if directory exists (Bun.file only works for files, use node:fs for directories)
        const { existsSync, statSync } = require('node:fs');
        let dirExists = false;
        try {
          dirExists = existsSync(path) && statSync(path).isDirectory();
        } catch {
          dirExists = false;
        }
        if (!dirExists) {
          return new Response(JSON.stringify({
            exists: false,
            hasSettings: false,
            isGitRepo: false,
            suggestedName: ''
          }), { headers: jsonHeaders });
        }

        // Check if .claude/settings.json exists
        const settingsPath = `${path}/.claude/settings.json`;
        const hasSettings = await Bun.file(settingsPath).exists();

        // Check if it's a git repo
        let isGitRepo = false;
        try {
          const gitProc = Bun.spawn(['git', 'rev-parse', '--git-dir'], {
            cwd: path,
            stdout: 'pipe',
            stderr: 'pipe'
          });
          const exitCode = await gitProc.exited;
          isGitRepo = exitCode === 0;
        } catch {
          isGitRepo = false;
        }

        // Suggest a name from directory basename
        const pathParts = path.split('/').filter(Boolean);
        const suggestedName = pathParts[pathParts.length - 1] || '';

        return new Response(JSON.stringify({
          exists: true,
          hasSettings,
          isGitRepo,
          suggestedName
        }), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Validate Path API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // POST /api/conflicts/:id/dismiss - Dismiss a conflict (E4-S5)
    if (url.pathname.match(/^\/api\/conflicts\/[^\/]+\/dismiss$/) && req.method === 'POST') {
      try {
        const id = url.pathname.split('/')[3];
        if (!id) throw new Error('Conflict ID is required');
        dismissConflict(decodeURIComponent(id));

        // Broadcast updated conflicts to all clients
        broadcastConflicts();

        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Conflicts API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // POST /api/install-hooks - Install hooks on a project (E5-S5)
    if (url.pathname === '/api/install-hooks' && req.method === 'POST') {
      try {
        const body = await req.json() as { projectPath?: string; projectName?: string; serverUrl?: string };
        const { projectPath, projectName, serverUrl } = body;

        if (!projectPath || !projectName) {
          return new Response(JSON.stringify({ error: 'Missing projectPath or projectName' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Validate projectName: alphanumeric, dashes, underscores, dots, spaces only
        if (!/^[a-zA-Z0-9_\-. ]+$/.test(projectName)) {
          return new Response(JSON.stringify({ error: 'Invalid projectName: only alphanumeric, dashes, underscores, dots, and spaces allowed' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Validate projectPath: must be absolute and no shell metacharacters
        if (!projectPath.startsWith('/') || /[;&|`$(){}!#]/.test(projectPath)) {
          return new Response(JSON.stringify({ error: 'Invalid projectPath: must be an absolute path without shell metacharacters' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Verify directory exists (Bun.file only works for files, use node:fs for directories)
        const { existsSync: dirExistsSync, statSync: dirStatSync } = require('node:fs');
        let dirExists = false;
        try {
          dirExists = dirExistsSync(projectPath) && dirStatSync(projectPath).isDirectory();
        } catch {
          dirExists = false;
        }
        if (!dirExists) {
          return new Response(JSON.stringify({
            success: false,
            output: '',
            error: `Directory does not exist: ${projectPath}`
          }), { status: 400, headers: jsonHeaders });
        }

        // Execute install-hooks.sh script (resolve from project root, two levels up from apps/server/)
        const { resolve: resolvePath } = require('node:path');
        const projectRoot = resolvePath(process.cwd(), '..', '..');
        const scriptPath = resolvePath(projectRoot, 'scripts', 'install-hooks.sh');
        const finalServerUrl: string = serverUrl || `http://localhost:${SERVER_PORT}/events`;

        const proc: ReturnType<typeof Bun.spawn> = Bun.spawn([
          'bash', scriptPath,
          projectPath,
          projectName,
          finalServerUrl
        ], {
          cwd: projectRoot,
          stdout: 'pipe',
          stderr: 'pipe'
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode: number = await proc.exited;

        const success: boolean = exitCode === 0;
        const output = stdout + (stderr ? '\n' + stderr : '');

        return new Response(JSON.stringify({
          success,
          output,
          error: success ? undefined : `Installation failed with exit code ${exitCode}`
        }), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Install Hooks API] Error:', error);
        return new Response(JSON.stringify({
          success: false,
          output: '',
          error: error.message || 'Internal server error'
        }), { status: 500, headers: jsonHeaders });
      }
    }

    // POST /api/test-hook - Send a test event (E5-S5)
    if (url.pathname === '/api/test-hook' && req.method === 'POST') {
      try {
        const body = await req.json() as { projectName?: string };
        const { projectName } = body;

        if (!projectName) {
          return new Response(JSON.stringify({ error: 'Missing projectName' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Create a synthetic test event
        const testEvent: HookEvent = {
          source_app: projectName,
          session_id: 'test-' + Date.now(),
          hook_event_type: 'TestHook',
          payload: {
            message: 'Test event from DevPulse Hook Wizard',
            timestamp: Date.now()
          },
          timestamp: Date.now()
        };

        // Insert into database
        const savedEvent = insertEvent(testEvent);

        // Broadcast to WebSocket clients
        const message = JSON.stringify({ type: 'event', data: savedEvent });
        wsClients.forEach(client => {
          try { client.send(message); } catch { wsClients.delete(client); }
        });

        return new Response(JSON.stringify({
          success: true,
          event: savedEvent
        }), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Test Hook API] Error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: error.message || 'Internal server error'
        }), { status: 500, headers: jsonHeaders });
      }
    }

    // =============================================
    // ADMIN API (E6-S4: Data Retention & Archival)
    // =============================================

    // GET /api/admin/stats - Get database and archive statistics
    if (url.pathname === '/api/admin/stats' && req.method === 'GET') {
      try {
        const settings = getAllSettings();
        const stats = await getAdminStats(getDb(), settings);
        return new Response(JSON.stringify(stats), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Admin Stats API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // POST /api/admin/cleanup - Trigger immediate cleanup
    if (url.pathname === '/api/admin/cleanup' && req.method === 'POST') {
      try {
        const settings = getAllSettings();
        const result = await runCleanup(getDb(), settings);
        return new Response(JSON.stringify(result), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Admin Cleanup API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/admin/settings - Get all retention settings
    if (url.pathname === '/api/admin/settings' && req.method === 'GET') {
      try {
        const settings = getAllSettings();
        return new Response(JSON.stringify(settings), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Admin Settings API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // PUT /api/admin/settings - Update retention settings
    if (url.pathname === '/api/admin/settings' && req.method === 'PUT') {
      try {
        const updates = await req.json() as Array<{ key: string; value: string }>;

        if (!Array.isArray(updates)) {
          return new Response(JSON.stringify({ error: 'Body must be an array of {key, value} objects' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Update each setting
        for (const { key, value } of updates) {
          if (!key || value === undefined) {
            return new Response(JSON.stringify({ error: 'Each update must have key and value' }), {
              status: 400, headers: jsonHeaders
            });
          }
          setSetting(key, value);
        }

        const updatedSettings = getAllSettings();
        return new Response(JSON.stringify(updatedSettings), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Admin Settings API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // =============================================
    // WEBHOOKS API (E6-S5)
    // =============================================

    // GET /api/webhooks - List all webhooks
    if (url.pathname === '/api/webhooks' && req.method === 'GET') {
      try {
        const stmt = getDb().prepare('SELECT * FROM webhooks ORDER BY created_at DESC');
        const webhooks = stmt.all() as Webhook[];
        return new Response(JSON.stringify(webhooks), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Webhooks API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // POST /api/webhooks - Create webhook
    if (url.pathname === '/api/webhooks' && req.method === 'POST') {
      try {
        const body = await req.json() as {
          name: string;
          url: string;
          secret?: string;
          eventTypes?: string[];
          projectFilter?: string;
        };

        const { name, url: webhookUrl, secret, eventTypes, projectFilter } = body;

        if (!name || !webhookUrl) {
          return new Response(JSON.stringify({ error: 'Missing required fields: name, url' }), {
            status: 400, headers: jsonHeaders
          });
        }

        // Validate webhook URL
        const urlValidation = validateWebhookUrl(webhookUrl);
        if (!urlValidation.valid) {
          return new Response(JSON.stringify({ error: urlValidation.error }), {
            status: 400, headers: jsonHeaders
          });
        }

        const now = Date.now();
        const id = `webhook-${now}-${Math.random().toString(36).slice(2, 11)}`;

        const stmt = getDb().prepare(`
          INSERT INTO webhooks (id, name, url, secret, event_types, project_filter, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `);

        stmt.run(
          id,
          name,
          webhookUrl,
          secret || '',
          JSON.stringify(eventTypes || []),
          projectFilter || '',
          now,
          now
        );

        const selectStmt = getDb().prepare('SELECT * FROM webhooks WHERE id = ?');
        const webhook = selectStmt.get(id) as Webhook;

        return new Response(JSON.stringify(webhook), {
          status: 201,
          headers: jsonHeaders
        });
      } catch (error: any) {
        console.error('[Webhooks API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // PUT /api/webhooks/:id - Update webhook
    if (url.pathname.match(/^\/api\/webhooks\/[^\/]+$/) && req.method === 'PUT') {
      try {
        const id = url.pathname.split('/')[3];
        const body = await req.json() as {
          name?: string;
          url?: string;
          secret?: string;
          eventTypes?: string[];
          projectFilter?: string;
          active?: boolean;
        };

        // Validate webhook URL if being updated
        if (body.url !== undefined) {
          const urlValidation = validateWebhookUrl(body.url);
          if (!urlValidation.valid) {
            return new Response(JSON.stringify({ error: urlValidation.error }), {
              status: 400, headers: jsonHeaders
            });
          }
        }

        const updates: string[] = [];
        const values: any[] = [];

        if (body.name !== undefined) {
          updates.push('name = ?');
          values.push(body.name);
        }
        if (body.url !== undefined) {
          updates.push('url = ?');
          values.push(body.url);
        }
        if (body.secret !== undefined) {
          updates.push('secret = ?');
          values.push(body.secret);
        }
        if (body.eventTypes !== undefined) {
          updates.push('event_types = ?');
          values.push(JSON.stringify(body.eventTypes));
        }
        if (body.projectFilter !== undefined) {
          updates.push('project_filter = ?');
          values.push(body.projectFilter);
        }
        if (body.active !== undefined) {
          updates.push('active = ?');
          values.push(body.active ? 1 : 0);
        }

        if (updates.length === 0) {
          return new Response(JSON.stringify({ error: 'No fields to update' }), {
            status: 400, headers: jsonHeaders
          });
        }

        updates.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const stmt = getDb().prepare(`
          UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?
        `);
        const result = stmt.run(...values);

        if (result.changes === 0) {
          return new Response(JSON.stringify({ error: 'Webhook not found' }), {
            status: 404, headers: jsonHeaders
          });
        }

        const selectStmt = getDb().prepare('SELECT * FROM webhooks WHERE id = ?');
        const webhook = selectStmt.get(id) as Webhook;

        return new Response(JSON.stringify(webhook), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Webhooks API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // DELETE /api/webhooks/:id - Delete webhook
    if (url.pathname.match(/^\/api\/webhooks\/[^\/]+$/) && req.method === 'DELETE') {
      try {
        const id = url.pathname.split('/')[3];
        const stmt = getDb().prepare('DELETE FROM webhooks WHERE id = ?');
        const result = stmt.run(id);

        if (result.changes === 0) {
          return new Response(JSON.stringify({ error: 'Webhook not found' }), {
            status: 404, headers: jsonHeaders
          });
        }

        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Webhooks API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // POST /api/webhooks/:id/test - Test webhook
    if (url.pathname.match(/^\/api\/webhooks\/[^\/]+\/test$/) && req.method === 'POST') {
      try {
        const id = url.pathname.split('/')[3];
        const stmt = getDb().prepare('SELECT * FROM webhooks WHERE id = ?');
        const webhook = stmt.get(id) as Webhook | undefined;

        if (!webhook) {
          return new Response(JSON.stringify({ error: 'Webhook not found' }), {
            status: 404, headers: jsonHeaders
          });
        }

        const result = await testWebhook(webhook);
        return new Response(JSON.stringify(result), { headers: jsonHeaders });
      } catch (error: any) {
        console.error('[Webhooks API] Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // GET /api/docs - API documentation
    if (url.pathname === '/api/docs' && req.method === 'GET') {
      // This endpoint is a placeholder - the actual documentation is static
      // and will be served by the client's apiDocs.ts file
      return new Response(JSON.stringify({
        message: 'API documentation available in the client application',
        version: '1.0.0'
      }), { headers: jsonHeaders });
    }

    // =============================================
    // THEMES API (existing)
    // =============================================
    
    if (url.pathname === '/api/themes' && req.method === 'POST') {
      try {
        const themeData = await req.json();
        const result = await createTheme(themeData);
        return new Response(JSON.stringify(result), {
          status: result.success ? 201 : 400, headers: jsonHeaders
        });
      } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid request body' }), {
          status: 400, headers: jsonHeaders
        });
      }
    }
    
    if (url.pathname === '/api/themes' && req.method === 'GET') {
      const query = {
        query: url.searchParams.get('query') || undefined,
        isPublic: url.searchParams.get('isPublic') ? url.searchParams.get('isPublic') === 'true' : undefined,
        authorId: url.searchParams.get('authorId') || undefined,
        sortBy: url.searchParams.get('sortBy') as any || undefined,
        sortOrder: url.searchParams.get('sortOrder') as any || undefined,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
        offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
      };
      const result = await searchThemes(query);
      return new Response(JSON.stringify(result), { headers: jsonHeaders });
    }
    
    if (url.pathname.match(/^\/api\/themes\/[^\/]+\/export$/) && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      const result = await exportThemeById(id);
      if (!result.success) {
        return new Response(JSON.stringify(result), {
          status: result.error?.includes('not found') ? 404 : 400, headers: jsonHeaders
        });
      }
      return new Response(JSON.stringify(result.data), {
        headers: { ...jsonHeaders, 'Content-Disposition': `attachment; filename="${result.data.theme.name}.json"` }
      });
    }
    
    if (url.pathname === '/api/themes/import' && req.method === 'POST') {
      try {
        const importData = await req.json();
        const authorId = url.searchParams.get('authorId');
        const result = await importTheme(importData, authorId || undefined);
        return new Response(JSON.stringify(result), {
          status: result.success ? 201 : 400, headers: jsonHeaders
        });
      } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid import data' }), {
          status: 400, headers: jsonHeaders
        });
      }
    }
    
    if (url.pathname === '/api/themes/stats' && req.method === 'GET') {
      const result = await getThemeStats();
      return new Response(JSON.stringify(result), { headers: jsonHeaders });
    }

    if (url.pathname.startsWith('/api/themes/') && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      if (!id) return new Response(JSON.stringify({ success: false, error: 'Theme ID required' }), { status: 400, headers: jsonHeaders });
      const result = await getThemeById(id);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 404, headers: jsonHeaders });
    }
    
    if (url.pathname.startsWith('/api/themes/') && req.method === 'PUT') {
      const id = url.pathname.split('/')[3];
      if (!id) return new Response(JSON.stringify({ success: false, error: 'Theme ID required' }), { status: 400, headers: jsonHeaders });
      try {
        const updates = await req.json();
        const result = await updateThemeById(id, updates);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: jsonHeaders });
      } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid request body' }), { status: 400, headers: jsonHeaders });
      }
    }
    
    if (url.pathname.startsWith('/api/themes/') && req.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      if (!id) return new Response(JSON.stringify({ success: false, error: 'Theme ID required' }), { status: 400, headers: jsonHeaders });
      const authorId = url.searchParams.get('authorId');
      const result = await deleteThemeById(id, authorId || undefined);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : (result.error?.includes('not found') ? 404 : 403), headers: jsonHeaders
      });
    }
    
    // WebSocket upgrade
    if (url.pathname === '/stream') {
      const success = server.upgrade(req);
      if (success) return undefined;
    }
    
    // Default
    return new Response('DevPulse - Multi-Session Development Dashboard', {
      headers: { ...headers, 'Content-Type': 'text/plain' }
    });
  },
  
  websocket: {
    open(ws) {
      // Limit concurrent WebSocket connections
      if (wsClients.size >= 20) {
        console.warn('[WebSocket] Connection limit reached (20), rejecting client');
        ws.close(1013, 'Too many connections');
        return;
      }

      console.log('WebSocket client connected');
      wsClients.add(ws);
      
      // Send recent events on connection
      const events = getRecentEvents(300);
      ws.send(JSON.stringify({ type: 'initial', data: events }));

      // Also send current project state
      const projects = getAllProjects();
      ws.send(JSON.stringify({ type: 'projects', data: projects }));

      const sessions = getActiveSessions();
      ws.send(JSON.stringify({ type: 'sessions', data: sessions }));

      // Send initial topology
      const topology = getAgentTopology();
      ws.send(JSON.stringify({ type: 'topology', data: topology }));

      // Send initial conflicts (E4-S5)
      const conflicts = getActiveConflicts();
      ws.send(JSON.stringify({ type: 'conflicts', data: conflicts }));

      // Send initial alerts (E5-S3)
      const alerts = checkAlerts(getDb());
      ws.send(JSON.stringify({ type: 'alerts', data: alerts }));
    },
    
    message(ws, message) {
      console.log('Received message:', message);
    },

    close(ws) {
      console.log('WebSocket client disconnected');
      wsClients.delete(ws);
    }
  }
});

// Broadcast project updates to all clients
function broadcastProjects() {
  const projects = getAllProjects();
  const sessions = getActiveSessions();
  const message = JSON.stringify({ type: 'projects', data: projects });
  const sessMessage = JSON.stringify({ type: 'sessions', data: sessions });

  wsClients.forEach(client => {
    try {
      client.send(message);
      client.send(sessMessage);
    } catch {
      wsClients.delete(client);
    }
  });
}

// Broadcast topology updates to all clients (E4-S1)
function broadcastTopology() {
  const topology = getAgentTopology();
  const message = JSON.stringify({ type: 'topology', data: topology });

  wsClients.forEach(client => {
    try {
      client.send(message);
    } catch {
      wsClients.delete(client);
    }
  });
}

// Broadcast conflict updates to all clients (E4-S5)
function broadcastConflicts() {
  const conflicts = getActiveConflicts();
  const message = JSON.stringify({ type: 'conflicts', data: conflicts });

  wsClients.forEach(client => {
    try {
      client.send(message);
    } catch {
      wsClients.delete(client);
    }
  });
}

// Broadcast alert updates to all clients (E5-S3)
function broadcastAlerts() {
  const alerts = checkAlerts(getDb());
  const message = JSON.stringify({ type: 'alerts', data: alerts });

  wsClients.forEach(client => {
    try {
      client.send(message);
    } catch {
      wsClients.delete(client);
    }
  });
}

function broadcastDevLogs() {
  const logs = getRecentDevLogs(50);
  const message = JSON.stringify({ type: 'devlogs', data: logs });

  wsClients.forEach(client => {
    try {
      client.send(message);
    } catch {
      wsClients.delete(client);
    }
  });
}

console.log(`🚀 DevPulse server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket: ws://localhost:${server.port}/stream`);
console.log(`📮 Events: POST http://localhost:${server.port}/events`);
console.log(`📋 Projects: GET http://localhost:${server.port}/api/projects`);
console.log(`📝 Dev Logs: GET http://localhost:${server.port}/api/devlogs`);
