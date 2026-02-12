/**
 * Tests for activity heatmap endpoint
 */

import { test, expect, describe, beforeAll } from "bun:test";
import { Database } from 'bun:sqlite';
import type { HookEvent } from './types';

// Create an in-memory test database
let db: Database;

beforeAll(() => {
  db = new Database(':memory:');

  // Create events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_app TEXT NOT NULL,
      session_id TEXT NOT NULL,
      hook_event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload TEXT
    )
  `);

  // Insert test events spanning different days and hours
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);

  const testEvents = [
    { source_app: 'ProjectA', session_id: 'sess1', hook_event_type: 'PreToolUse', timestamp: now },
    { source_app: 'ProjectA', session_id: 'sess1', hook_event_type: 'PostToolUse', timestamp: now + 1000 },
    { source_app: 'ProjectA', session_id: 'sess1', hook_event_type: 'PreToolUse', timestamp: now + 2000 },
    { source_app: 'ProjectB', session_id: 'sess2', hook_event_type: 'PreToolUse', timestamp: oneDayAgo },
    { source_app: 'ProjectB', session_id: 'sess2', hook_event_type: 'PostToolUse', timestamp: oneDayAgo + 1000 },
    { source_app: 'ProjectA', session_id: 'sess3', hook_event_type: 'PreToolUse', timestamp: twoDaysAgo },
  ];

  const insertStmt = db.prepare(`
    INSERT INTO events (source_app, session_id, hook_event_type, timestamp, payload)
    VALUES (?, ?, ?, ?, ?)
  `);

  testEvents.forEach(event => {
    insertStmt.run(event.source_app, event.session_id, event.hook_event_type, event.timestamp, '{}');
  });
});

describe('Heatmap API', () => {
  test('should aggregate events by day and hour', () => {
    const threshold = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const sql = `
      SELECT
        date(timestamp/1000, 'unixepoch', 'localtime') as day,
        CAST(strftime('%H', timestamp/1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as count
      FROM events
      WHERE timestamp > ?
      GROUP BY day, hour
      ORDER BY day, hour
    `;

    const stmt = db.prepare(sql);
    const rows = stmt.all(threshold) as any[];

    // Should have multiple rows (one per day/hour combination)
    expect(rows.length).toBeGreaterThan(0);

    // Each row should have day, hour, and count
    rows.forEach(row => {
      expect(row).toHaveProperty('day');
      expect(row).toHaveProperty('hour');
      expect(row).toHaveProperty('count');
      expect(typeof row.hour).toBe('number');
      expect(row.hour).toBeGreaterThanOrEqual(0);
      expect(row.hour).toBeLessThan(24);
      expect(row.count).toBeGreaterThan(0);
    });
  });

  test('should filter by project when specified', () => {
    const threshold = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const sql = `
      SELECT
        date(timestamp/1000, 'unixepoch', 'localtime') as day,
        CAST(strftime('%H', timestamp/1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as count
      FROM events
      WHERE timestamp > ?
        AND source_app = ?
      GROUP BY day, hour
      ORDER BY day, hour
    `;

    const stmt = db.prepare(sql);
    const rows = stmt.all(threshold, 'ProjectA') as any[];

    // Should only have events from ProjectA (4 total)
    const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
    expect(totalCount).toBe(4);
  });

  test('should return empty cells when no data exists', () => {
    const threshold = Date.now() + (24 * 60 * 60 * 1000); // Future timestamp

    const sql = `
      SELECT
        date(timestamp/1000, 'unixepoch', 'localtime') as day,
        CAST(strftime('%H', timestamp/1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as count
      FROM events
      WHERE timestamp > ?
      GROUP BY day, hour
      ORDER BY day, hour
    `;

    const stmt = db.prepare(sql);
    const rows = stmt.all(threshold) as any[];

    expect(rows.length).toBe(0);
  });

  test('should calculate maxCount correctly', () => {
    const threshold = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const sql = `
      SELECT
        date(timestamp/1000, 'unixepoch', 'localtime') as day,
        CAST(strftime('%H', timestamp/1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as count
      FROM events
      WHERE timestamp > ?
      GROUP BY day, hour
      ORDER BY day, hour
    `;

    const stmt = db.prepare(sql);
    const rows = stmt.all(threshold) as any[];

    const maxCount = rows.length > 0 ? Math.max(...rows.map(r => r.count)) : 0;

    // maxCount should be 3 (3 events in the same day/hour bucket)
    expect(maxCount).toBe(3);
  });
});
