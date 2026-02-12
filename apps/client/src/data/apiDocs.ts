export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  parameters?: Array<{
    name: string;
    type: string;
    required: boolean;
    location: 'query' | 'path' | 'body';
    description: string;
  }>;
  requestBody?: {
    contentType: string;
    schema: string;
    example: string;
  };
  response: {
    status: number;
    schema: string;
    example: string;
  };
}

export interface WebSocketMessage {
  type: string;
  description: string;
  dataShape: string;
  example: string;
}

export interface ApiDocumentation {
  version: string;
  baseUrl: string;
  endpoints: ApiEndpoint[];
  websocket: {
    url: string;
    messages: WebSocketMessage[];
  };
}

export const apiDocumentation: ApiDocumentation = {
  version: '1.0.0',
  baseUrl: 'http://localhost:4000',
  endpoints: [
    // Events API
    {
      method: 'POST',
      path: '/events',
      description: 'Receive a new hook event from a Claude Code agent',
      requestBody: {
        contentType: 'application/json',
        schema: `{
  source_app: string;
  session_id: string;
  hook_event_type: string;
  payload: object;
  chat?: any[];
  summary?: string;
  timestamp?: number;
  model_name?: string;
}`,
        example: `{
  "source_app": "MyProject",
  "session_id": "abc123",
  "hook_event_type": "PostToolUse",
  "payload": { "tool_name": "Read", "result": "..." },
  "timestamp": 1707744000000
}`
      },
      response: {
        status: 200,
        schema: 'HookEvent',
        example: '{ "id": 1, "source_app": "MyProject", ... }'
      }
    },
    {
      method: 'GET',
      path: '/events/recent',
      description: 'Get recent events',
      parameters: [
        {
          name: 'limit',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Maximum number of events to return (default: 300)'
        }
      ],
      response: {
        status: 200,
        schema: 'HookEvent[]',
        example: '[{ "id": 1, "source_app": "MyProject", ... }]'
      }
    },
    {
      method: 'GET',
      path: '/events/filter-options',
      description: 'Get available filter options for events',
      response: {
        status: 200,
        schema: '{ source_apps: string[], session_ids: string[], hook_event_types: string[] }',
        example: '{ "source_apps": ["Project1", "Project2"], ... }'
      }
    },

    // Projects API
    {
      method: 'GET',
      path: '/api/projects',
      description: 'List all projects with their current status',
      response: {
        status: 200,
        schema: 'Project[]',
        example: '[{ "name": "MyProject", "active_sessions": 2, ... }]'
      }
    },
    {
      method: 'GET',
      path: '/api/projects/:name',
      description: 'Get detailed status for a specific project',
      parameters: [
        {
          name: 'name',
          type: 'string',
          required: true,
          location: 'path',
          description: 'Project name (URL-encoded)'
        }
      ],
      response: {
        status: 200,
        schema: 'ProjectStatus',
        example: '{ "project": {...}, "sessions": [...], "recent_logs": [...] }'
      }
    },

    // Sessions API
    {
      method: 'GET',
      path: '/api/sessions',
      description: 'List all active sessions across all projects',
      response: {
        status: 200,
        schema: 'Session[]',
        example: '[{ "session_id": "abc123", "status": "active", ... }]'
      }
    },
    {
      method: 'GET',
      path: '/api/sessions/:sessionId/events',
      description: 'Get all events for a specific session',
      parameters: [
        {
          name: 'sessionId',
          type: 'string',
          required: true,
          location: 'path',
          description: 'Session ID'
        },
        {
          name: 'source_app',
          type: 'string',
          required: true,
          location: 'query',
          description: 'Source application name'
        }
      ],
      response: {
        status: 200,
        schema: 'HookEvent[]',
        example: '[{ "id": 1, "hook_event_type": "SessionStart", ... }]'
      }
    },

    // Dev Logs API
    {
      method: 'GET',
      path: '/api/devlogs',
      description: 'Get recent development logs',
      parameters: [
        {
          name: 'limit',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Maximum number of logs (default: 50)'
        },
        {
          name: 'project',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Filter by project name'
        }
      ],
      response: {
        status: 200,
        schema: 'DevLog[]',
        example: '[{ "summary": "Implemented feature X", "files_changed": [...], ... }]'
      }
    },

    // Topology API
    {
      method: 'GET',
      path: '/api/topology',
      description: 'Get agent hierarchy and topology',
      parameters: [
        {
          name: 'project',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Filter by project name'
        }
      ],
      response: {
        status: 200,
        schema: 'AgentNode[]',
        example: '[{ "agent_id": "Project:abc123", "parent_id": null, "children": [...] }]'
      }
    },

    // Summaries API
    {
      method: 'GET',
      path: '/api/summaries',
      description: 'Get daily or weekly summary reports',
      parameters: [
        {
          name: 'period',
          type: 'string',
          required: true,
          location: 'query',
          description: 'Summary period: "daily" or "weekly"'
        },
        {
          name: 'date',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Date in YYYY-MM-DD format (required for daily)'
        },
        {
          name: 'week',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Week in YYYY-Www format (required for weekly)'
        }
      ],
      response: {
        status: 200,
        schema: 'PeriodSummary',
        example: '{ "period": "daily", "projects": [...], "totals": {...} }'
      }
    },

    // Costs API
    {
      method: 'GET',
      path: '/api/costs',
      description: 'Get cost estimates grouped by project, session, or day',
      parameters: [
        {
          name: 'group',
          type: 'string',
          required: true,
          location: 'query',
          description: 'Grouping: "project", "session", or "daily"'
        },
        {
          name: 'project',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Project filter (required for session grouping)'
        },
        {
          name: 'startDate',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Start timestamp (optional for project grouping)'
        },
        {
          name: 'endDate',
          type: 'number',
          required: false,
          location: 'query',
          description: 'End timestamp (optional for project grouping)'
        },
        {
          name: 'days',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Number of days (default: 7 for daily grouping)'
        }
      ],
      response: {
        status: 200,
        schema: 'ProjectCost[] | SessionCost[] | DailyCost[]',
        example: '[{ "project_name": "MyProject", "total_cost_usd": 0.45, ... }]'
      }
    },

    // Metrics API
    {
      method: 'GET',
      path: '/api/metrics',
      description: 'Get agent performance metrics',
      parameters: [
        {
          name: 'group',
          type: 'string',
          required: true,
          location: 'query',
          description: 'Grouping: "session" or "project"'
        },
        {
          name: 'project',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Project filter (required for session grouping)'
        },
        {
          name: 'start',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Start timestamp filter'
        },
        {
          name: 'end',
          type: 'number',
          required: false,
          location: 'query',
          description: 'End timestamp filter'
        }
      ],
      response: {
        status: 200,
        schema: 'SessionMetrics[] | ProjectMetrics[]',
        example: '[{ "session_id": "abc123", "tool_success_rate": 95.5, ... }]'
      }
    },

    // Conflicts API
    {
      method: 'GET',
      path: '/api/conflicts',
      description: 'Get active file conflicts between sessions',
      parameters: [
        {
          name: 'window',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Time window in minutes (default: 30)'
        }
      ],
      response: {
        status: 200,
        schema: 'FileConflict[]',
        example: '[{ "file_path": "src/app.ts", "severity": "high", ... }]'
      }
    },
    {
      method: 'POST',
      path: '/api/conflicts/:id/dismiss',
      description: 'Dismiss a file conflict',
      parameters: [
        {
          name: 'id',
          type: 'string',
          required: true,
          location: 'path',
          description: 'Conflict ID'
        }
      ],
      response: {
        status: 200,
        schema: '{ success: boolean }',
        example: '{ "success": true }'
      }
    },

    // Search API
    {
      method: 'GET',
      path: '/api/search',
      description: 'Full-text search across events, sessions, and dev logs',
      parameters: [
        {
          name: 'q',
          type: 'string',
          required: true,
          location: 'query',
          description: 'Search query'
        },
        {
          name: 'type',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Search scope: "events", "sessions", "devlogs", or "all" (default)'
        },
        {
          name: 'limit',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Max results per category (default: 20, max: 100)'
        }
      ],
      response: {
        status: 200,
        schema: '{ events: {...}, sessions: {...}, devlogs: {...} }',
        example: '{ "events": { "count": 5, "results": [...] }, ... }'
      }
    },

    // Analytics API
    {
      method: 'GET',
      path: '/api/analytics/heatmap',
      description: 'Get activity heatmap data for visualization',
      parameters: [
        {
          name: 'days',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Number of days to include (default: 30, max: 365)'
        },
        {
          name: 'project',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Project filter'
        }
      ],
      response: {
        status: 200,
        schema: '{ cells: Array<{day, hour, count}>, maxCount: number }',
        example: '{ "cells": [{"day": "2026-02-12", "hour": 14, "count": 45}], "maxCount": 120 }'
      }
    },

    // Export API
    {
      method: 'GET',
      path: '/api/export/report',
      description: 'Generate and download HTML report',
      parameters: [
        {
          name: 'project',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Project filter'
        },
        {
          name: 'sessionId',
          type: 'string',
          required: false,
          location: 'query',
          description: 'Session filter'
        },
        {
          name: 'from',
          type: 'number',
          required: false,
          location: 'query',
          description: 'Start timestamp'
        },
        {
          name: 'to',
          type: 'number',
          required: false,
          location: 'query',
          description: 'End timestamp'
        }
      ],
      response: {
        status: 200,
        schema: 'HTML document',
        example: '<!DOCTYPE html>...'
      }
    },

    // Webhooks API
    {
      method: 'GET',
      path: '/api/webhooks',
      description: 'List all configured webhooks',
      response: {
        status: 200,
        schema: 'Webhook[]',
        example: '[{ "id": "webhook-123", "name": "Slack Alert", "url": "...", ... }]'
      }
    },
    {
      method: 'POST',
      path: '/api/webhooks',
      description: 'Create a new webhook',
      requestBody: {
        contentType: 'application/json',
        schema: `{
  name: string;
  url: string;
  secret?: string;
  eventTypes?: string[];
  projectFilter?: string;
}`,
        example: `{
  "name": "Slack Notifications",
  "url": "https://hooks.slack.com/services/...",
  "secret": "my-secret-key",
  "eventTypes": ["SessionStart", "SessionStop"],
  "projectFilter": "MyProject"
}`
      },
      response: {
        status: 201,
        schema: 'Webhook',
        example: '{ "id": "webhook-123", "name": "Slack Notifications", ... }'
      }
    },
    {
      method: 'PUT',
      path: '/api/webhooks/:id',
      description: 'Update an existing webhook',
      parameters: [
        {
          name: 'id',
          type: 'string',
          required: true,
          location: 'path',
          description: 'Webhook ID'
        }
      ],
      requestBody: {
        contentType: 'application/json',
        schema: `{
  name?: string;
  url?: string;
  secret?: string;
  eventTypes?: string[];
  projectFilter?: string;
  active?: boolean;
}`,
        example: `{
  "active": false
}`
      },
      response: {
        status: 200,
        schema: 'Webhook',
        example: '{ "id": "webhook-123", "active": 0, ... }'
      }
    },
    {
      method: 'DELETE',
      path: '/api/webhooks/:id',
      description: 'Delete a webhook',
      parameters: [
        {
          name: 'id',
          type: 'string',
          required: true,
          location: 'path',
          description: 'Webhook ID'
        }
      ],
      response: {
        status: 200,
        schema: '{ success: boolean }',
        example: '{ "success": true }'
      }
    },
    {
      method: 'POST',
      path: '/api/webhooks/:id/test',
      description: 'Send a test payload to webhook URL',
      parameters: [
        {
          name: 'id',
          type: 'string',
          required: true,
          location: 'path',
          description: 'Webhook ID'
        }
      ],
      response: {
        status: 200,
        schema: '{ success: boolean, status: number, error?: string }',
        example: '{ "success": true, "status": 200 }'
      }
    },

    // Admin API
    {
      method: 'GET',
      path: '/api/admin/stats',
      description: 'Get database and archive statistics',
      response: {
        status: 200,
        schema: '{ database: {...}, archives: {...} }',
        example: '{ "database": { "total_events": 1234, ... }, "archives": [...] }'
      }
    },
    {
      method: 'POST',
      path: '/api/admin/cleanup',
      description: 'Trigger immediate data cleanup',
      response: {
        status: 200,
        schema: '{ deleted: {...}, archived: {...} }',
        example: '{ "deleted": { "events": 100, ... }, ... }'
      }
    },
    {
      method: 'GET',
      path: '/api/admin/settings',
      description: 'Get all retention settings',
      response: {
        status: 200,
        schema: 'Record<string, string>',
        example: '{ "retention.events.days": "30", ... }'
      }
    },
    {
      method: 'PUT',
      path: '/api/admin/settings',
      description: 'Update retention settings',
      requestBody: {
        contentType: 'application/json',
        schema: 'Array<{ key: string, value: string }>',
        example: '[{ "key": "retention.events.days", "value": "60" }]'
      },
      response: {
        status: 200,
        schema: 'Record<string, string>',
        example: '{ "retention.events.days": "60", ... }'
      }
    }
  ],

  websocket: {
    url: 'ws://localhost:4000/stream',
    messages: [
      {
        type: 'initial',
        description: 'Sent when client first connects, contains recent events',
        dataShape: '{ type: "initial", data: HookEvent[] }',
        example: `{
  "type": "initial",
  "data": [
    { "id": 1, "source_app": "MyProject", "hook_event_type": "SessionStart", ... }
  ]
}`
      },
      {
        type: 'event',
        description: 'Broadcast when a new event is received',
        dataShape: '{ type: "event", data: HookEvent }',
        example: `{
  "type": "event",
  "data": { "id": 2, "source_app": "MyProject", "hook_event_type": "PostToolUse", ... }
}`
      },
      {
        type: 'projects',
        description: 'Broadcast when project data is updated',
        dataShape: '{ type: "projects", data: Project[] }',
        example: `{
  "type": "projects",
  "data": [{ "name": "MyProject", "active_sessions": 2, ... }]
}`
      },
      {
        type: 'sessions',
        description: 'Broadcast when session data is updated',
        dataShape: '{ type: "sessions", data: Session[] }',
        example: `{
  "type": "sessions",
  "data": [{ "session_id": "abc123", "status": "active", ... }]
}`
      },
      {
        type: 'topology',
        description: 'Broadcast when agent topology changes',
        dataShape: '{ type: "topology", data: AgentNode[] }',
        example: `{
  "type": "topology",
  "data": [{ "agent_id": "Project:abc123", "parent_id": null, ... }]
}`
      },
      {
        type: 'conflicts',
        description: 'Broadcast when file conflicts are detected or dismissed',
        dataShape: '{ type: "conflicts", data: FileConflict[] }',
        example: `{
  "type": "conflicts",
  "data": [{ "file_path": "src/app.ts", "severity": "high", ... }]
}`
      },
      {
        type: 'alerts',
        description: 'Broadcast when alerts are triggered or updated',
        dataShape: '{ type: "alerts", data: Alert[] }',
        example: `{
  "type": "alerts",
  "data": [{ "type": "error_spike", "severity": "high", ... }]
}`
      }
    ]
  }
};
