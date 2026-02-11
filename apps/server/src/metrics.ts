import type { Database } from 'bun:sqlite';
import type { HookEvent, SessionMetrics, ProjectMetrics } from './types';

let db: Database;

export function initMetrics(database: Database): void {
  db = database;
}

/**
 * Calculate median value from a sorted or unsorted array of numbers.
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

/**
 * Extract turn durations from event sequence.
 * A turn starts at UserPromptSubmit and ends at the next Stop or Notification.
 */
export function calculateTurnDurations(events: HookEvent[]): number[] {
  const durations: number[] = [];
  let turnStartTime: number | null = null;

  for (const event of events) {
    if (event.hook_event_type === 'UserPromptSubmit') {
      turnStartTime = event.timestamp || 0;
    } else if (turnStartTime !== null && (event.hook_event_type === 'Stop' || event.hook_event_type === 'Notification')) {
      const duration = (event.timestamp || 0) - turnStartTime;
      if (duration > 0) {
        durations.push(duration / 1000); // Convert to seconds
      }
      turnStartTime = null;
    }
  }

  // Ignore incomplete turns (UserPromptSubmit without Stop/Notification)
  return durations;
}

/**
 * Build activity timeline by bucketing events into minute intervals.
 */
export function buildActivityTimeline(events: HookEvent[], startedAt: number): Array<{ minute: number; events: number }> {
  if (events.length === 0) return [];

  const buckets = new Map<number, number>();

  for (const event of events) {
    const timestamp = event.timestamp || 0;
    const minutesSinceStart = Math.floor((timestamp - startedAt) / 60000);
    buckets.set(minutesSinceStart, (buckets.get(minutesSinceStart) || 0) + 1);
  }

  // Convert to array and sort by minute
  const timeline = Array.from(buckets.entries())
    .map(([minute, events]) => ({ minute, events }))
    .sort((a, b) => a.minute - b.minute);

  return timeline;
}

/**
 * Calculate tool usage metrics from events.
 */
function calculateToolMetrics(events: HookEvent[]): {
  toolUseCount: number;
  toolFailureCount: number;
  toolSuccessRate: number;
  toolBreakdown: Record<string, { success: number; failure: number }>;
} {
  let toolUseCount = 0;
  let toolFailureCount = 0;
  const toolBreakdown: Record<string, { success: number; failure: number }> = {};

  for (const event of events) {
    if (event.hook_event_type === 'PostToolUse') {
      toolUseCount++;
      const toolName = event.payload?.tool_name || 'unknown';
      if (!toolBreakdown[toolName]) {
        toolBreakdown[toolName] = { success: 0, failure: 0 };
      }
      toolBreakdown[toolName].success++;
    } else if (event.hook_event_type === 'PostToolUseFailure') {
      toolFailureCount++;
      const toolName = event.payload?.tool_name || 'unknown';
      if (!toolBreakdown[toolName]) {
        toolBreakdown[toolName] = { success: 0, failure: 0 };
      }
      toolBreakdown[toolName].failure++;
    }
  }

  const totalToolEvents = toolUseCount + toolFailureCount;
  const toolSuccessRate = totalToolEvents > 0 ? (toolUseCount / totalToolEvents) * 100 : 100;

  return { toolUseCount, toolFailureCount, toolSuccessRate, toolBreakdown };
}

/**
 * Calculate turn duration statistics.
 */
function calculateTurnStats(turnDurations: number[]): {
  turnCount: number;
  avgTurnDuration: number;
  medianTurnDuration: number;
  minTurnDuration: number;
  maxTurnDuration: number;
} {
  const turnCount = turnDurations.length;
  const avgTurnDuration = turnCount > 0 ? turnDurations.reduce((sum, d) => sum + d, 0) / turnCount : 0;
  const medianTurnDuration = calculateMedian(turnDurations);
  const minTurnDuration = turnCount > 0 ? Math.min(...turnDurations) : 0;
  const maxTurnDuration = turnCount > 0 ? Math.max(...turnDurations) : 0;

  return { turnCount, avgTurnDuration, medianTurnDuration, minTurnDuration, maxTurnDuration };
}

/**
 * Calculate activity rate metrics.
 */
function calculateActivityMetrics(events: HookEvent[], startedAt: number): {
  totalEvents: number;
  eventsPerMinute: number;
  sessionDurationMinutes: number;
} {
  const totalEvents = events.length;
  const lastEvent = events[events.length - 1];
  const sessionDurationMs = (lastEvent.timestamp || 0) - startedAt;
  const sessionDurationMinutes = sessionDurationMs / 60000;
  const eventsPerMinute = sessionDurationMinutes > 0 ? totalEvents / sessionDurationMinutes : 0;

  return { totalEvents, eventsPerMinute, sessionDurationMinutes };
}

/**
 * Compute all metrics for a single session, optionally filtered by date range.
 */
export function getSessionMetrics(sessionId: string, sourceApp: string, startTimestamp?: number, endTimestamp?: number): SessionMetrics | null {
  // Get all events for this session ordered by timestamp
  let sql = `
    SELECT source_app, session_id, hook_event_type, payload, timestamp, model_name
    FROM events
    WHERE session_id = ? AND source_app = ?
  `;
  const params: any[] = [sessionId, sourceApp];

  if (startTimestamp !== undefined) {
    sql += ' AND timestamp >= ?';
    params.push(startTimestamp);
  }

  if (endTimestamp !== undefined) {
    sql += ' AND timestamp <= ?';
    params.push(endTimestamp);
  }

  sql += ' ORDER BY timestamp ASC';

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as any[];

  if (rows.length === 0) return null;

  const events: HookEvent[] = rows.map(row => ({
    source_app: row.source_app,
    session_id: row.session_id,
    hook_event_type: row.hook_event_type,
    payload: JSON.parse(row.payload),
    timestamp: row.timestamp,
    model_name: row.model_name || 'unknown'
  }));

  // Get project name from session table
  const sessionStmt = db.prepare('SELECT project_name, started_at FROM sessions WHERE session_id = ? AND source_app = ?');
  const sessionRow = sessionStmt.get(sessionId, sourceApp) as any;
  const projectName = sessionRow?.project_name || 'unknown';
  const startedAt = sessionRow?.started_at || events[0].timestamp || Date.now();

  // Calculate all metrics using extracted helper functions
  const toolMetrics = calculateToolMetrics(events);
  const turnDurations = calculateTurnDurations(events);
  const turnStats = calculateTurnStats(turnDurations);
  const activityMetrics = calculateActivityMetrics(events, startedAt);
  const activityTimeline = buildActivityTimeline(events, startedAt);

  return {
    session_id: sessionId,
    source_app: sourceApp,
    project_name: projectName,
    model_name: events[0].model_name || 'unknown',
    tool_use_count: toolMetrics.toolUseCount,
    tool_failure_count: toolMetrics.toolFailureCount,
    tool_success_rate: toolMetrics.toolSuccessRate,
    tool_breakdown: toolMetrics.toolBreakdown,
    turn_count: turnStats.turnCount,
    avg_turn_duration_seconds: turnStats.avgTurnDuration,
    median_turn_duration_seconds: turnStats.medianTurnDuration,
    min_turn_duration_seconds: turnStats.minTurnDuration,
    max_turn_duration_seconds: turnStats.maxTurnDuration,
    total_events: activityMetrics.totalEvents,
    events_per_minute: activityMetrics.eventsPerMinute,
    session_duration_minutes: activityMetrics.sessionDurationMinutes,
    activity_timeline: activityTimeline
  };
}

/**
 * Get aggregate metrics for all projects or a specific project, optionally filtered by date range.
 */
export function getProjectMetrics(projectName?: string, startTimestamp?: number, endTimestamp?: number): ProjectMetrics[] {
  // Get all sessions, optionally filtered by project and date range
  let sql = 'SELECT DISTINCT session_id, source_app, project_name FROM sessions';
  const params: any[] = [];
  const conditions: string[] = [];

  if (projectName) {
    conditions.push('project_name = ?');
    params.push(projectName);
  }

  if (startTimestamp !== undefined) {
    conditions.push('started_at >= ?');
    params.push(startTimestamp);
  }

  if (endTimestamp !== undefined) {
    conditions.push('started_at <= ?');
    params.push(endTimestamp);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const stmt = db.prepare(sql);
  const sessionRows = stmt.all(...params) as any[];

  // Group sessions by project
  const projectMap = new Map<string, Array<{ session_id: string; source_app: string }>>();

  for (const row of sessionRows) {
    const proj = row.project_name || 'unknown';
    if (!projectMap.has(proj)) {
      projectMap.set(proj, []);
    }
    projectMap.get(proj)!.push({ session_id: row.session_id, source_app: row.source_app });
  }

  // Compute metrics for each project
  const results: ProjectMetrics[] = [];

  for (const [proj, sessions] of projectMap.entries()) {
    let totalSuccessRate = 0;
    let totalTurnDuration = 0;
    let totalEvents = 0;
    let totalDuration = 0;
    let validSessionCount = 0;

    for (const { session_id, source_app } of sessions) {
      const metrics = getSessionMetrics(session_id, source_app, startTimestamp, endTimestamp);
      if (metrics) {
        totalSuccessRate += metrics.tool_success_rate;
        totalTurnDuration += metrics.avg_turn_duration_seconds;
        totalEvents += metrics.total_events;
        totalDuration += metrics.session_duration_minutes;
        validSessionCount++;
      }
    }

    results.push({
      project_name: proj,
      session_count: sessions.length,
      avg_tool_success_rate: validSessionCount > 0 ? totalSuccessRate / validSessionCount : 100,
      avg_turn_duration_seconds: validSessionCount > 0 ? totalTurnDuration / validSessionCount : 0,
      total_events: totalEvents,
      total_duration_minutes: totalDuration
    });
  }

  return results;
}
