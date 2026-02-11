import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { checkAlerts, type AlertThresholds } from './alerts';
import type { HookEvent } from './types';

// Helper to create test database
function createTestDb(): Database {
  const db = new Database(':memory:');

  // Create sessions table
  db.exec(`
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      status TEXT NOT NULL,
      last_event_at INTEGER NOT NULL,
      started_at INTEGER NOT NULL
    )
  `);

  // Create events table
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_app TEXT NOT NULL,
      session_id TEXT NOT NULL,
      hook_event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload TEXT NOT NULL
    )
  `);

  return db;
}

// Helper to insert test session
function insertSession(db: Database, sessionId: string, sourceApp: string, status: string, lastEventAt: number) {
  const stmt = db.prepare(`
    INSERT INTO sessions (session_id, source_app, status, last_event_at, started_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(sessionId, sourceApp, status, lastEventAt, Date.now() - 3600000);
}

// Helper to insert test event
function insertEvent(db: Database, sessionId: string, sourceApp: string, hookEventType: string, payload: any, timestamp: number) {
  const stmt = db.prepare(`
    INSERT INTO events (source_app, session_id, hook_event_type, timestamp, payload)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(sourceApp, sessionId, hookEventType, timestamp, JSON.stringify(payload));
}

test('checkAlerts returns stuck_agent alert when session is active but idle > 5 minutes', () => {
  const db = createTestDb();
  const now = Date.now();
  const sixMinutesAgo = now - (6 * 60 * 1000);

  // Insert an active session with last event 6 minutes ago
  insertSession(db, 'test-session-123', 'test-app', 'active', sixMinutesAgo);

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(1);
  expect(alerts[0].type).toBe('stuck_agent');
  expect(alerts[0].severity).toBe('warning');
  expect(alerts[0].sessionId).toBe('test-session-123');
  expect(alerts[0].sourceApp).toBe('test-app');
  expect(alerts[0].agentLabel).toContain('test-app:test-ses'); // truncated session ID
  expect(alerts[0].message).toContain('6 minutes');

  db.close();
});

test('checkAlerts does not return stuck_agent alert for idle sessions', () => {
  const db = createTestDb();
  const now = Date.now();
  const sixMinutesAgo = now - (6 * 60 * 1000);

  // Insert an idle session (not active)
  insertSession(db, 'test-session-123', 'test-app', 'idle', sixMinutesAgo);

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(0);

  db.close();
});

test('checkAlerts returns excessive_writes alert when >50 Write/Edit events within 1 minute', () => {
  const db = createTestDb();
  const now = Date.now();

  // Insert 51 Write events within the last minute
  for (let i = 0; i < 51; i++) {
    insertEvent(
      db,
      'test-session-456',
      'write-heavy-app',
      'PostToolUse',
      { tool_name: 'Write', file_path: `/test/file${i}.txt` },
      now - (i * 1000) // Spread across the last 51 seconds
    );
  }

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(1);
  expect(alerts[0].type).toBe('excessive_writes');
  expect(alerts[0].severity).toBe('critical');
  expect(alerts[0].sessionId).toBe('test-session-456');
  expect(alerts[0].sourceApp).toBe('write-heavy-app');
  expect(alerts[0].message).toContain('51 file writes');

  db.close();
});

test('checkAlerts returns excessive_writes alert for Edit events', () => {
  const db = createTestDb();
  const now = Date.now();

  // Insert 51 Edit events within the last minute
  for (let i = 0; i < 51; i++) {
    insertEvent(
      db,
      'test-session-789',
      'edit-heavy-app',
      'PostToolUse',
      { tool_name: 'Edit', file_path: `/test/file${i}.txt` },
      now - (i * 1000)
    );
  }

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(1);
  expect(alerts[0].type).toBe('excessive_writes');
  expect(alerts[0].severity).toBe('critical');

  db.close();
});

test('checkAlerts does not return excessive_writes alert when count is below threshold', () => {
  const db = createTestDb();
  const now = Date.now();

  // Insert 49 Write events (below threshold of 50)
  for (let i = 0; i < 49; i++) {
    insertEvent(
      db,
      'test-session-999',
      'normal-app',
      'PostToolUse',
      { tool_name: 'Write', file_path: `/test/file${i}.txt` },
      now - (i * 1000)
    );
  }

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(0);

  db.close();
});

test('checkAlerts returns repeated_failures alert when >5 PostToolUseFailure events within 2 minutes', () => {
  const db = createTestDb();
  const now = Date.now();

  // Insert 6 PostToolUseFailure events within the last 2 minutes
  for (let i = 0; i < 6; i++) {
    insertEvent(
      db,
      'test-session-fail',
      'failing-app',
      'PostToolUseFailure',
      { error: 'File not found' },
      now - (i * 10000) // Spread across 60 seconds
    );
  }

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(1);
  expect(alerts[0].type).toBe('repeated_failures');
  expect(alerts[0].severity).toBe('warning'); // warning for >5, critical for >10
  expect(alerts[0].sessionId).toBe('test-session-fail');
  expect(alerts[0].sourceApp).toBe('failing-app');
  expect(alerts[0].message).toContain('6 tool failures');

  db.close();
});

test('checkAlerts returns critical severity for >10 failures', () => {
  const db = createTestDb();
  const now = Date.now();

  // Insert 11 PostToolUseFailure events
  for (let i = 0; i < 11; i++) {
    insertEvent(
      db,
      'test-session-crit',
      'critical-app',
      'PostToolUseFailure',
      { error: 'Permission denied' },
      now - (i * 5000)
    );
  }

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(1);
  expect(alerts[0].type).toBe('repeated_failures');
  expect(alerts[0].severity).toBe('critical');

  db.close();
});

test('checkAlerts respects custom thresholds', () => {
  const db = createTestDb();
  const now = Date.now();

  const customThresholds: AlertThresholds = {
    stuckAgentMinutes: 2, // 2 minutes instead of 5
    excessiveWritesCount: 10, // 10 instead of 50
    excessiveWritesWindowMs: 30000, // 30 seconds instead of 60
    repeatedFailuresCount: 3, // 3 instead of 5
    repeatedFailuresWindowMs: 60000, // 1 minute instead of 2
  };

  // Insert session stuck for 3 minutes (> custom threshold of 2)
  const threeMinutesAgo = now - (3 * 60 * 1000);
  insertSession(db, 'stuck-session', 'stuck-app', 'active', threeMinutesAgo);

  // Insert 11 Write events within 30 seconds (> custom threshold of 10)
  for (let i = 0; i < 11; i++) {
    insertEvent(
      db,
      'write-session',
      'write-app',
      'PostToolUse',
      { tool_name: 'Write', file_path: `/file${i}.txt` },
      now - (i * 2000) // Within 22 seconds
    );
  }

  // Insert 4 failure events within 1 minute (> custom threshold of 3)
  for (let i = 0; i < 4; i++) {
    insertEvent(
      db,
      'fail-session',
      'fail-app',
      'PostToolUseFailure',
      { error: 'Error' },
      now - (i * 10000)
    );
  }

  const alerts = checkAlerts(db, customThresholds);

  // Should have 3 alerts with custom thresholds
  expect(alerts.length).toBe(3);
  expect(alerts.some(a => a.type === 'stuck_agent')).toBe(true);
  expect(alerts.some(a => a.type === 'excessive_writes')).toBe(true);
  expect(alerts.some(a => a.type === 'repeated_failures')).toBe(true);

  db.close();
});

test('checkAlerts returns empty array when no anomalies detected', () => {
  const db = createTestDb();
  const now = Date.now();

  // Insert a normal active session (last event 1 minute ago)
  const oneMinuteAgo = now - (1 * 60 * 1000);
  insertSession(db, 'normal-session', 'normal-app', 'active', oneMinuteAgo);

  // Insert a few normal Write events
  for (let i = 0; i < 5; i++) {
    insertEvent(
      db,
      'normal-session',
      'normal-app',
      'PostToolUse',
      { tool_name: 'Write', file_path: `/file${i}.txt` },
      now - (i * 10000)
    );
  }

  const alerts = checkAlerts(db);

  expect(alerts.length).toBe(0);

  db.close();
});
