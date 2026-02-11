import { initDatabase, getDb, insertEvent, getFilterOptions, getRecentEvents, updateEventHITLResponse } from './db';
import {
  initEnricher, enrichEvent, getAllProjects, getActiveSessions,
  getProjectStatus, getRecentDevLogs, getDevLogsForProject,
  markIdleSessions, cleanupOldSessions, scanPorts, getAgentTopology
} from './enricher';
import type { HookEvent, HumanInTheLoopResponse } from './types';
import {
  createTheme, updateThemeById, getThemeById, searchThemes,
  deleteThemeById, exportThemeById, importTheme, getThemeStats
} from './theme';
import { initVercelPoller } from './vercel';
import { initSummaries, getDailySummary, getWeeklySummary } from './summaries';

// Initialize database and enricher
initDatabase();
initEnricher(getDb());
initVercelPoller(getDb());
initSummaries(getDb());

// Mark idle sessions every 30 seconds
setInterval(() => {
  markIdleSessions();
  broadcastProjects(); // Broadcast session updates to clients when idle status changes
}, 30000);

// Cleanup old sessions every hour
setInterval(() => cleanupOldSessions(), 3600000);

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

// Create Bun server
const server = Bun.serve({
  port: parseInt(process.env.SERVER_PORT || '4000'),
  
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
    },
    
    message(ws, message) {
      console.log('Received message:', message);
    },
    
    close(ws) {
      console.log('WebSocket client disconnected');
      wsClients.delete(ws);
    },
    
    error(ws, error) {
      console.error('WebSocket error:', error);
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

console.log(`🚀 DevPulse server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket: ws://localhost:${server.port}/stream`);
console.log(`📮 Events: POST http://localhost:${server.port}/events`);
console.log(`📋 Projects: GET http://localhost:${server.port}/api/projects`);
console.log(`📝 Dev Logs: GET http://localhost:${server.port}/api/devlogs`);
