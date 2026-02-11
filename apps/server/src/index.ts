import { initDatabase, getDb, insertEvent, getFilterOptions, getRecentEvents, updateEventHITLResponse, getEventsForSession } from './db';
import {
  initEnricher, enrichEvent, getAllProjects, getActiveSessions,
  getProjectStatus, getRecentDevLogs, getDevLogsForProject,
  markIdleSessions, cleanupOldSessions, cleanupOldFileAccessLogs, scanPorts, getAgentTopology
} from './enricher';
import type { HookEvent, HumanInTheLoopResponse } from './types';
import {
  createTheme, updateThemeById, getThemeById, searchThemes,
  deleteThemeById, exportThemeById, importTheme, getThemeStats
} from './theme';
import { initVercelPoller } from './vercel';
import { initSummaries, getDailySummary, getWeeklySummary } from './summaries';
import { getCostsByProject, getCostsBySession, getDailyCosts } from './costs';
import { initMetrics, getSessionMetrics, getProjectMetrics } from './metrics';
import { getActiveConflicts, dismissConflict, detectConflicts } from './conflicts';
import { checkAlerts } from './alerts';

// Initialize database and enricher
initDatabase();
initEnricher(getDb());
initVercelPoller(getDb());
initSummaries(getDb());
initMetrics(getDb());

// Mark idle sessions and check alerts every 30 seconds
setInterval(() => {
  markIdleSessions();
  broadcastProjects(); // Broadcast session updates to clients when idle status changes
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
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };

// Server port constant
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '4000');

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
      try {
        const event: HookEvent = await req.json();
        
        if (!event.source_app || !event.session_id || !event.hook_event_type || !event.payload) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), {
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
      const limit = parseInt(url.searchParams.get('limit') || '300');
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
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const project = url.searchParams.get('project');

      const logs = project
        ? getDevLogsForProject(project, limit)
        : getRecentDevLogs(limit);

      return new Response(JSON.stringify(logs), { headers: jsonHeaders });
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

        // Check if directory exists
        const dirExists = await Bun.file(path).exists();
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

        // Verify directory exists
        const dirExists = await Bun.file(projectPath).exists();
        if (!dirExists) {
          return new Response(JSON.stringify({
            success: false,
            output: '',
            error: `Directory does not exist: ${projectPath}`
          }), { status: 400, headers: jsonHeaders });
        }

        // Execute install-hooks.sh script
        const scriptPath = './scripts/install-hooks.sh';
        const finalServerUrl: string = serverUrl || `http://localhost:${SERVER_PORT}/events`;

        const proc: ReturnType<typeof Bun.spawn> = Bun.spawn([
          'bash', scriptPath,
          projectPath,
          projectName,
          finalServerUrl
        ], {
          cwd: process.cwd(),
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

console.log(`🚀 DevPulse server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket: ws://localhost:${server.port}/stream`);
console.log(`📮 Events: POST http://localhost:${server.port}/events`);
console.log(`📋 Projects: GET http://localhost:${server.port}/api/projects`);
console.log(`📝 Dev Logs: GET http://localhost:${server.port}/api/devlogs`);
