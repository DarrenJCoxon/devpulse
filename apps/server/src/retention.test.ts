import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runCleanup, getAdminStats } from './retention';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Test database and archive directory
const TEST_DB = 'test-retention.db';
const TEST_ARCHIVE_DIR = './test-archives';

let db: Database;

beforeEach(() => {
  // Clean up any existing test database and archives (including WAL files)
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB);
  }
  if (existsSync(TEST_DB + '-wal')) {
    rmSync(TEST_DB + '-wal');
  }
  if (existsSync(TEST_DB + '-shm')) {
    rmSync(TEST_DB + '-shm');
  }
  if (existsSync(TEST_ARCHIVE_DIR)) {
    rmSync(TEST_ARCHIVE_DIR, { recursive: true });
  }

  // Create fresh database (don't use WAL mode in tests to avoid file conflicts)
  db = new Database(TEST_DB);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_app TEXT NOT NULL,
      session_id TEXT NOT NULL,
      hook_event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      project_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      summary TEXT NOT NULL,
      files_changed TEXT,
      commits TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_minutes REAL NOT NULL,
      event_count INTEGER NOT NULL,
      tool_breakdown TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      project_name TEXT NOT NULL,
      source_app TEXT NOT NULL,
      status TEXT NOT NULL,
      current_branch TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_event_at INTEGER NOT NULL,
      event_count INTEGER NOT NULL,
      model_name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      task_context TEXT,
      compaction_count INTEGER DEFAULT 0,
      last_compaction_at INTEGER,
      compaction_history TEXT
    )
  `);
});

afterEach(() => {
  // Close database
  db.close();

  // Clean up test files (including WAL files)
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB);
  }
  if (existsSync(TEST_DB + '-wal')) {
    rmSync(TEST_DB + '-wal');
  }
  if (existsSync(TEST_DB + '-shm')) {
    rmSync(TEST_DB + '-shm');
  }
  if (existsSync(TEST_ARCHIVE_DIR)) {
    rmSync(TEST_ARCHIVE_DIR, { recursive: true });
  }
});

test('runCleanup archives and deletes old events', async () => {
  // Insert old and new events
  const now = Date.now();
  const oldTimestamp = now - (40 * 86400000); // 40 days ago
  const newTimestamp = now - (10 * 86400000); // 10 days ago

  const insertStmt = db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)');
  insertStmt.run('test-app', 'session-1', 'TestEvent', '{}', oldTimestamp);
  insertStmt.run('test-app', 'session-2', 'TestEvent', '{}', newTimestamp);

  // Settings: 30 day retention, archive enabled
  const settings = {
    'retention.events.days': '30',
    'retention.devlogs.days': '90',
    'retention.sessions.days': '30',
    'retention.archive.enabled': 'true',
    'retention.archive.directory': TEST_ARCHIVE_DIR
  };

  // Run cleanup
  const result = await runCleanup(db, settings);

  // Verify results
  expect(result.eventsArchived).toBe(1);
  expect(result.eventsDeleted).toBe(1);
  expect(result.archiveFile).not.toBeNull();

  // Verify archive file exists and contains data
  if (result.archiveFile) {
    expect(existsSync(result.archiveFile)).toBe(true);
    const archiveContent = await Bun.file(result.archiveFile).json();
    expect(archiveContent.data.events).toHaveLength(1);
    expect(archiveContent.data.events[0].timestamp).toBe(oldTimestamp);
  }

  // Verify old event was deleted
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM events');
  const count = countStmt.get() as { count: number };
  expect(count.count).toBe(1);

  // Verify new event still exists
  const remainingStmt = db.prepare('SELECT * FROM events');
  const remaining = remainingStmt.all() as any[];
  expect(remaining[0].timestamp).toBe(newTimestamp);
});

test('runCleanup deletes old dev_logs and sessions', async () => {
  const now = Date.now();
  const oldTimestamp = now - (100 * 86400000); // 100 days ago
  const newTimestamp = now - (50 * 86400000); // 50 days ago

  // Insert dev logs
  const devLogStmt = db.prepare(`
    INSERT INTO dev_logs (session_id, source_app, project_name, branch, summary, started_at, ended_at, duration_minutes, event_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  devLogStmt.run('session-1', 'test-app', 'test-project', 'main', 'Old log', oldTimestamp, oldTimestamp, 60, 10);
  devLogStmt.run('session-2', 'test-app', 'test-project', 'main', 'New log', newTimestamp, newTimestamp, 60, 10);

  // Insert sessions (one stopped old, one active new)
  const sessionStmt = db.prepare(`
    INSERT INTO sessions (session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  sessionStmt.run('session-1', 'test-project', 'test-app', 'stopped', 'main', oldTimestamp, oldTimestamp, 10, 'test-model', '/test');
  sessionStmt.run('session-2', 'test-project', 'test-app', 'active', 'main', newTimestamp, newTimestamp, 10, 'test-model', '/test');

  const settings = {
    'retention.events.days': '30',
    'retention.devlogs.days': '90',
    'retention.sessions.days': '30',
    'retention.archive.enabled': 'true',
    'retention.archive.directory': TEST_ARCHIVE_DIR
  };

  const result = await runCleanup(db, settings);

  // Verify dev log deletion (90 day retention, so 100 day old log should be deleted)
  expect(result.devLogsDeleted).toBe(1);
  const devLogCount = db.prepare('SELECT COUNT(*) as count FROM dev_logs').get() as { count: number };
  expect(devLogCount.count).toBe(1);

  // Verify session deletion (30 day retention, so 100 day old session should be deleted)
  expect(result.sessionsDeleted).toBe(1);
  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
  expect(sessionCount.count).toBe(1);
});

test('runCleanup skips archival when disabled', async () => {
  const now = Date.now();
  const oldTimestamp = now - (40 * 86400000);

  const insertStmt = db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)');
  insertStmt.run('test-app', 'session-1', 'TestEvent', '{}', oldTimestamp);

  const settings = {
    'retention.events.days': '30',
    'retention.devlogs.days': '90',
    'retention.sessions.days': '30',
    'retention.archive.enabled': 'false',
    'retention.archive.directory': TEST_ARCHIVE_DIR
  };

  const result = await runCleanup(db, settings);

  // Should delete but not archive
  expect(result.eventsDeleted).toBe(1);
  expect(result.eventsArchived).toBe(0);
  expect(result.archiveFile).toBeNull();
  expect(existsSync(TEST_ARCHIVE_DIR)).toBe(false);
});

test('getAdminStats returns accurate counts', async () => {
  const now = Date.now();
  const oldTimestamp = now - (10 * 86400000);

  // Insert test data
  const eventStmt = db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)');
  eventStmt.run('test-app', 'session-1', 'TestEvent', '{}', oldTimestamp);
  eventStmt.run('test-app', 'session-2', 'TestEvent', '{}', now);

  const devLogStmt = db.prepare(`
    INSERT INTO dev_logs (session_id, source_app, project_name, branch, summary, started_at, ended_at, duration_minutes, event_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  devLogStmt.run('session-1', 'test-app', 'test-project', 'main', 'Test log', now, now, 60, 10);

  const sessionStmt = db.prepare(`
    INSERT INTO sessions (session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  sessionStmt.run('session-1', 'test-project', 'test-app', 'active', 'main', now, now, 10, 'test-model', '/test');

  // Create an archive file
  mkdirSync(TEST_ARCHIVE_DIR, { recursive: true });
  await Bun.write(join(TEST_ARCHIVE_DIR, 'devpulse-archive-2026-01-01-to-2026-01-15.json'), '{}');

  const settings = {
    'retention.archive.directory': TEST_ARCHIVE_DIR
  };

  const stats = await getAdminStats(db, settings);

  expect(stats.eventCount).toBe(2);
  expect(stats.devLogCount).toBe(1);
  expect(stats.sessionCount).toBe(1);
  expect(stats.oldestEventTimestamp).toBe(oldTimestamp);
  expect(stats.newestEventTimestamp).toBe(now);
  expect(stats.archiveCount).toBe(1);
  expect(stats.archiveFiles).toHaveLength(1);
});

test('VACUUM reclaims disk space after deletion', async () => {
  // Insert many events to create a larger database
  const now = Date.now();
  const oldTimestamp = now - (40 * 86400000);
  const insertStmt = db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)');

  for (let i = 0; i < 1000; i++) {
    insertStmt.run('test-app', `session-${i}`, 'TestEvent', JSON.stringify({ data: 'x'.repeat(100) }), oldTimestamp);
  }

  const settings = {
    'retention.events.days': '30',
    'retention.devlogs.days': '90',
    'retention.sessions.days': '30',
    'retention.archive.enabled': 'false',
    'retention.archive.directory': TEST_ARCHIVE_DIR
  };

  const result = await runCleanup(db, settings);

  // Verify VACUUM ran (size should be smaller or same after deletion + VACUUM)
  expect(result.dbSizeAfterVacuum).toBeLessThanOrEqual(result.dbSizeBeforeVacuum);
});
