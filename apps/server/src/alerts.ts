import type { Database } from 'bun:sqlite';

export interface Alert {
  id: string;              // Unique: `${type}-${sessionId}-${sourceApp}` (stable for dismiss tracking)
  type: 'stuck_agent' | 'excessive_writes' | 'repeated_failures';
  severity: 'warning' | 'critical';
  sessionId: string;
  sourceApp: string;
  agentLabel: string;      // "source_app:session_id" (truncated)
  message: string;
  detectedAt: number;
}

export interface AlertThresholds {
  stuckAgentMinutes: number;         // default: 5
  excessiveWritesCount: number;      // default: 50
  excessiveWritesWindowMs: number;   // default: 60000
  repeatedFailuresCount: number;     // default: 5
  repeatedFailuresWindowMs: number;  // default: 120000
}

// Database row types
interface StuckAgentRow {
  session_id: string;
  source_app: string;
  last_event_at: number;
}

interface EventCountRow {
  session_id: string;
  source_app: string;
  cnt: number;
}

// Default thresholds
const DEFAULT_THRESHOLDS: AlertThresholds = {
  stuckAgentMinutes: 5,
  excessiveWritesCount: 50,
  excessiveWritesWindowMs: 60000,
  repeatedFailuresCount: 5,
  repeatedFailuresWindowMs: 120000,
};

/**
 * Truncates session ID to first 8 characters for display
 */
function truncateSessionId(sessionId: string): string {
  return sessionId.substring(0, 8);
}

/**
 * Creates agent label in format "source_app:session_id" (truncated)
 */
function createAgentLabel(sourceApp: string, sessionId: string): string {
  return `${sourceApp}:${truncateSessionId(sessionId)}`;
}

/**
 * Checks for stuck agents (active sessions with no events for > threshold minutes)
 */
function checkStuckAgents(db: Database, thresholds: AlertThresholds): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();
  const thresholdMs = thresholds.stuckAgentMinutes * 60 * 1000;
  const cutoffTime = now - thresholdMs;

  const stmt = db.prepare(`
    SELECT session_id, source_app, last_event_at
    FROM sessions
    WHERE status = 'active' AND last_event_at < ?
  `);

  const rows = stmt.all(cutoffTime) as StuckAgentRow[];

  for (const row of rows) {
    const agentLabel = createAgentLabel(row.source_app, row.session_id);
    const minutesInactive = Math.floor((now - row.last_event_at) / 60000);

    alerts.push({
      id: `stuck_agent-${row.session_id}-${row.source_app}`,
      type: 'stuck_agent',
      severity: 'warning',
      sessionId: row.session_id,
      sourceApp: row.source_app,
      agentLabel,
      message: `Agent ${agentLabel} has been active but idle for ${minutesInactive} minutes`,
      detectedAt: now,
    });
  }

  return alerts;
}

/**
 * Checks for excessive writes (>threshold Write/Edit events within time window)
 */
function checkExcessiveWrites(db: Database, thresholds: AlertThresholds): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();
  const cutoffTime = now - thresholds.excessiveWritesWindowMs;

  const stmt = db.prepare(`
    SELECT session_id, source_app, COUNT(*) as cnt
    FROM events
    WHERE hook_event_type = 'PostToolUse'
      AND (payload LIKE '%"tool_name":"Write"%' OR payload LIKE '%"tool_name":"Edit"%')
      AND timestamp > ?
    GROUP BY session_id, source_app
    HAVING cnt > ?
  `);

  const rows = stmt.all(cutoffTime, thresholds.excessiveWritesCount) as EventCountRow[];

  for (const row of rows) {
    const agentLabel = createAgentLabel(row.source_app, row.session_id);
    const windowSeconds = thresholds.excessiveWritesWindowMs / 1000;

    alerts.push({
      id: `excessive_writes-${row.session_id}-${row.source_app}`,
      type: 'excessive_writes',
      severity: 'critical',
      sessionId: row.session_id,
      sourceApp: row.source_app,
      agentLabel,
      message: `Agent ${agentLabel} performed ${row.cnt} file writes in ${windowSeconds}s (threshold: ${thresholds.excessiveWritesCount})`,
      detectedAt: now,
    });
  }

  return alerts;
}

/**
 * Checks for repeated failures (>threshold PostToolUseFailure events within time window)
 */
function checkRepeatedFailures(db: Database, thresholds: AlertThresholds): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();
  const cutoffTime = now - thresholds.repeatedFailuresWindowMs;

  const stmt = db.prepare(`
    SELECT session_id, source_app, COUNT(*) as cnt
    FROM events
    WHERE hook_event_type = 'PostToolUseFailure'
      AND timestamp > ?
    GROUP BY session_id, source_app
    HAVING cnt > ?
  `);

  const rows = stmt.all(cutoffTime, thresholds.repeatedFailuresCount) as EventCountRow[];

  for (const row of rows) {
    const agentLabel = createAgentLabel(row.source_app, row.session_id);
    const windowSeconds = thresholds.repeatedFailuresWindowMs / 1000;

    // Severity: warning if >5, critical if >10
    const severity = row.cnt > 10 ? 'critical' : 'warning';

    alerts.push({
      id: `repeated_failures-${row.session_id}-${row.source_app}`,
      type: 'repeated_failures',
      severity,
      sessionId: row.session_id,
      sourceApp: row.source_app,
      agentLabel,
      message: `Agent ${agentLabel} had ${row.cnt} tool failures in ${windowSeconds}s (threshold: ${thresholds.repeatedFailuresCount})`,
      detectedAt: now,
    });
  }

  return alerts;
}

/**
 * Main function to check all alert conditions and return current alerts
 */
export function checkAlerts(db: Database, thresholds: AlertThresholds = DEFAULT_THRESHOLDS): Alert[] {
  const alerts: Alert[] = [];

  try {
    alerts.push(...checkStuckAgents(db, thresholds));
    alerts.push(...checkExcessiveWrites(db, thresholds));
    alerts.push(...checkRepeatedFailures(db, thresholds));
  } catch (error) {
    console.error('[Alerts] Error checking alerts:', error);
  }

  return alerts;
}
