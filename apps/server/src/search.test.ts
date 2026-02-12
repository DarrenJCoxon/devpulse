import { describe, test, expect, beforeAll } from 'bun:test';
import { initDatabase, getDb, insertEvent } from './db';
import type { HookEvent } from './types';

describe('Search Database Queries', () => {
  beforeAll(() => {
    initDatabase();

    // Insert test data
    const testEvent: HookEvent = {
      source_app: 'TestSearchApp',
      session_id: 'search-test-session-123',
      hook_event_type: 'Write',
      payload: { message: 'Test write operation for searching' },
      summary: 'Test event for search functionality',
      timestamp: Date.now()
    };
    insertEvent(testEvent);

    // Insert a session
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO sessions (
        session_id, source_app, project_name, status, current_branch,
        started_at, last_event_at, event_count, model_name, cwd, task_context,
        compaction_count, last_compaction_at, compaction_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'search-test-session-123',
      'TestSearchApp',
      'TestProject',
      'active',
      'main',
      Date.now(),
      Date.now(),
      1,
      'sonnet',
      '/test/path',
      '{}',
      0,
      null,
      '[]'
    );

    // Insert a dev log
    db.prepare(`
      INSERT INTO dev_logs (
        session_id, source_app, project_name, branch, summary,
        files_changed, commits, started_at, ended_at, duration_minutes,
        event_count, tool_breakdown
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'search-test-session-123',
      'TestSearchApp',
      'TestProject',
      'main',
      'Implemented search functionality for testing',
      JSON.stringify(['test.ts']),
      JSON.stringify(['Initial commit']),
      Date.now() - 60000,
      Date.now(),
      1,
      1,
      JSON.stringify({ Write: 1 })
    );
  });

  test('searches events by payload', () => {
    const db = getDb();
    const searchTerm = '%searching%';

    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE payload LIKE ? OR summary LIKE ? OR source_app LIKE ?
    `);

    const result = stmt.get(searchTerm, searchTerm, searchTerm) as any;
    expect(result.count).toBeGreaterThan(0);
  });

  test('searches events by summary', () => {
    const db = getDb();
    const searchTerm = '%search functionality%';

    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE payload LIKE ? OR summary LIKE ? OR source_app LIKE ?
      ORDER BY timestamp DESC LIMIT 10
    `);

    const results = stmt.all(searchTerm, searchTerm, searchTerm) as any[];
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].summary).toContain('search');
  });

  test('searches sessions by session_id', () => {
    const db = getDb();
    const searchTerm = '%search-test%';

    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE session_id LIKE ?
         OR source_app LIKE ?
         OR project_name LIKE ?
         OR current_branch LIKE ?
    `);

    const result = stmt.get(searchTerm, searchTerm, searchTerm, searchTerm) as any;
    expect(result.count).toBeGreaterThan(0);
  });

  test('searches sessions by project_name', () => {
    const db = getDb();
    const searchTerm = '%TestProject%';

    const stmt = db.prepare(`
      SELECT * FROM sessions
      WHERE session_id LIKE ?
         OR source_app LIKE ?
         OR project_name LIKE ?
         OR current_branch LIKE ?
      ORDER BY last_event_at DESC LIMIT 10
    `);

    const results = stmt.all(searchTerm, searchTerm, searchTerm, searchTerm) as any[];
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project_name).toBe('TestProject');
  });

  test('searches dev_logs by summary', () => {
    const db = getDb();
    const searchTerm = '%search functionality%';

    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM dev_logs
      WHERE summary LIKE ?
         OR files_changed LIKE ?
         OR project_name LIKE ?
    `);

    const result = stmt.get(searchTerm, searchTerm, searchTerm) as any;
    expect(result.count).toBeGreaterThan(0);
  });

  test('searches dev_logs by files_changed', () => {
    const db = getDb();
    const searchTerm = '%test.ts%';

    const stmt = db.prepare(`
      SELECT * FROM dev_logs
      WHERE summary LIKE ?
         OR files_changed LIKE ?
         OR project_name LIKE ?
      ORDER BY ended_at DESC LIMIT 10
    `);

    const results = stmt.all(searchTerm, searchTerm, searchTerm) as any[];
    expect(results.length).toBeGreaterThan(0);
  });

  test('respects limit parameter', () => {
    const db = getDb();
    const searchTerm = '%Test%';
    const limit = 2;

    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE payload LIKE ? OR summary LIKE ? OR source_app LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `);

    const results = stmt.all(searchTerm, searchTerm, searchTerm, limit) as any[];
    expect(results.length).toBeLessThanOrEqual(limit);
  });

  test('searches are case-insensitive', () => {
    const db = getDb();
    const searchTermLower = '%test%';
    const searchTermUpper = '%TEST%';

    const stmtLower = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE payload LIKE ? OR summary LIKE ? OR source_app LIKE ?
    `);

    const stmtUpper = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE payload LIKE ? OR summary LIKE ? OR source_app LIKE ?
    `);

    const resultLower = stmtLower.get(searchTermLower, searchTermLower, searchTermLower) as any;
    const resultUpper = stmtUpper.get(searchTermUpper, searchTermUpper, searchTermUpper) as any;

    // SQLite LIKE is case-insensitive by default
    expect(resultLower.count).toBeGreaterThan(0);
    expect(resultUpper.count).toBeGreaterThan(0);
  });
});
