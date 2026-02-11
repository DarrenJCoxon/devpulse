import { test, expect, describe, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  initMetrics,
  calculateMedian,
  calculateTurnDurations,
  buildActivityTimeline,
  getSessionMetrics,
  getProjectMetrics
} from './metrics';
import type { HookEvent } from './types';

describe('metrics', () => {
  let db: Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Create necessary tables
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_app TEXT NOT NULL,
        session_id TEXT NOT NULL,
        hook_event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        model_name TEXT
      )
    `);

    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT NOT NULL,
        source_app TEXT NOT NULL,
        project_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, source_app)
      )
    `);

    initMetrics(db);
  });

  describe('calculateMedian', () => {
    test('returns 0 for empty array', () => {
      expect(calculateMedian([])).toBe(0);
    });

    test('returns correct median for odd-length array', () => {
      expect(calculateMedian([1, 2, 3, 4, 5])).toBe(3);
      expect(calculateMedian([5, 1, 3])).toBe(3);
    });

    test('returns correct median for even-length array', () => {
      expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
      expect(calculateMedian([4, 1, 3, 2])).toBe(2.5);
    });
  });

  describe('calculateTurnDurations', () => {
    test('correctly pairs UserPromptSubmit with Stop events', () => {
      const events: HookEvent[] = [
        { source_app: 'app', session_id: 'sess', hook_event_type: 'UserPromptSubmit', payload: {}, timestamp: 1000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Stop', payload: {}, timestamp: 5000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'UserPromptSubmit', payload: {}, timestamp: 6000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Stop', payload: {}, timestamp: 10000 }
      ];

      const durations = calculateTurnDurations(events);
      expect(durations).toEqual([4, 4]); // 4 seconds each
    });

    test('pairs UserPromptSubmit with Notification events', () => {
      const events: HookEvent[] = [
        { source_app: 'app', session_id: 'sess', hook_event_type: 'UserPromptSubmit', payload: {}, timestamp: 1000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Notification', payload: {}, timestamp: 3000 }
      ];

      const durations = calculateTurnDurations(events);
      expect(durations).toEqual([2]);
    });

    test('handles edge case where session ends without Stop', () => {
      const events: HookEvent[] = [
        { source_app: 'app', session_id: 'sess', hook_event_type: 'UserPromptSubmit', payload: {}, timestamp: 1000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Stop', payload: {}, timestamp: 5000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'UserPromptSubmit', payload: {}, timestamp: 6000 }
        // No Stop event after second UserPromptSubmit
      ];

      const durations = calculateTurnDurations(events);
      expect(durations).toEqual([4]); // Only the complete turn
    });
  });

  describe('buildActivityTimeline', () => {
    test('correctly buckets events by minute', () => {
      const startedAt = 1000;
      const events: HookEvent[] = [
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Start', payload: {}, timestamp: 1000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Event1', payload: {}, timestamp: 10000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Event2', payload: {}, timestamp: 20000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Event3', payload: {}, timestamp: 61000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Event4', payload: {}, timestamp: 65000 },
        { source_app: 'app', session_id: 'sess', hook_event_type: 'Event5', payload: {}, timestamp: 121000 }
      ];

      const timeline = buildActivityTimeline(events, startedAt);

      expect(timeline).toEqual([
        { minute: 0, events: 3 },
        { minute: 1, events: 2 },
        { minute: 2, events: 1 }
      ]);
    });

    test('returns empty array for no events', () => {
      const timeline = buildActivityTimeline([], 1000);
      expect(timeline).toEqual([]);
    });
  });

  describe('tool success rate calculation', () => {
    test('calculates 80% success rate for 8 success + 2 failures', () => {
      // Insert session
      db.prepare('INSERT INTO sessions (session_id, source_app, project_name, started_at) VALUES (?, ?, ?, ?)').run(
        'sess1', 'app1', 'TestProject', 1000
      );

      // Insert 8 PostToolUse events
      for (let i = 0; i < 8; i++) {
        db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
          'app1', 'sess1', 'PostToolUse', JSON.stringify({ tool_name: 'TestTool' }), 1000 + i * 1000
        );
      }

      // Insert 2 PostToolUseFailure events
      for (let i = 0; i < 2; i++) {
        db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
          'app1', 'sess1', 'PostToolUseFailure', JSON.stringify({ tool_name: 'TestTool' }), 9000 + i * 1000
        );
      }

      const metrics = getSessionMetrics('sess1', 'app1');

      expect(metrics).not.toBeNull();
      expect(metrics?.tool_use_count).toBe(8);
      expect(metrics?.tool_failure_count).toBe(2);
      expect(metrics?.tool_success_rate).toBe(80);
    });
  });

  describe('getSessionMetrics', () => {
    test('returns null for non-existent session', () => {
      const metrics = getSessionMetrics('nonexistent', 'app');
      expect(metrics).toBeNull();
    });

    test('computes all metrics correctly for a complete session', () => {
      // Insert session
      db.prepare('INSERT INTO sessions (session_id, source_app, project_name, started_at) VALUES (?, ?, ?, ?)').run(
        'sess1', 'app1', 'TestProject', 1000
      );

      // Insert events
      const events = [
        { hook_event_type: 'Start', timestamp: 1000 },
        { hook_event_type: 'UserPromptSubmit', timestamp: 2000 },
        { hook_event_type: 'PostToolUse', timestamp: 3000 },
        { hook_event_type: 'PostToolUse', timestamp: 4000 },
        { hook_event_type: 'Stop', timestamp: 10000 },
        { hook_event_type: 'UserPromptSubmit', timestamp: 11000 },
        { hook_event_type: 'PostToolUseFailure', timestamp: 12000 },
        { hook_event_type: 'Stop', timestamp: 14000 }
      ];

      for (const evt of events) {
        db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp, model_name) VALUES (?, ?, ?, ?, ?, ?)').run(
          'app1', 'sess1', evt.hook_event_type, JSON.stringify({ tool_name: 'TestTool' }), evt.timestamp, 'test-model'
        );
      }

      const metrics = getSessionMetrics('sess1', 'app1');

      expect(metrics).not.toBeNull();
      expect(metrics?.session_id).toBe('sess1');
      expect(metrics?.source_app).toBe('app1');
      expect(metrics?.project_name).toBe('TestProject');
      expect(metrics?.model_name).toBe('test-model');
      expect(metrics?.tool_use_count).toBe(2);
      expect(metrics?.tool_failure_count).toBe(1);
      expect(metrics?.tool_success_rate).toBeCloseTo(66.67, 1);
      expect(metrics?.turn_count).toBe(2);
      expect(metrics?.avg_turn_duration_seconds).toBe(5.5); // (8 + 3) / 2
      expect(metrics?.median_turn_duration_seconds).toBe(5.5);
      expect(metrics?.total_events).toBe(8);
    });
  });

  describe('getProjectMetrics', () => {
    test('aggregates metrics across multiple sessions', () => {
      // Insert two sessions for same project
      db.prepare('INSERT INTO sessions (session_id, source_app, project_name, started_at) VALUES (?, ?, ?, ?)').run(
        'sess1', 'app1', 'Project1', 1000
      );
      db.prepare('INSERT INTO sessions (session_id, source_app, project_name, started_at) VALUES (?, ?, ?, ?)').run(
        'sess2', 'app2', 'Project1', 2000
      );

      // Insert events for session 1
      db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
        'app1', 'sess1', 'PostToolUse', JSON.stringify({}), 1000
      );
      db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
        'app1', 'sess1', 'PostToolUse', JSON.stringify({}), 2000
      );

      // Insert events for session 2
      db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
        'app2', 'sess2', 'PostToolUse', JSON.stringify({}), 2000
      );
      db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
        'app2', 'sess2', 'PostToolUseFailure', JSON.stringify({}), 3000
      );

      const projectMetrics = getProjectMetrics('Project1');

      expect(projectMetrics).toHaveLength(1);
      expect(projectMetrics[0].project_name).toBe('Project1');
      expect(projectMetrics[0].session_count).toBe(2);
      expect(projectMetrics[0].total_events).toBe(4);
    });

    test('returns metrics for all projects when no project specified', () => {
      // Insert sessions for two different projects
      db.prepare('INSERT INTO sessions (session_id, source_app, project_name, started_at) VALUES (?, ?, ?, ?)').run(
        'sess1', 'app1', 'Project1', 1000
      );
      db.prepare('INSERT INTO sessions (session_id, source_app, project_name, started_at) VALUES (?, ?, ?, ?)').run(
        'sess2', 'app2', 'Project2', 2000
      );

      // Insert events
      db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
        'app1', 'sess1', 'PostToolUse', JSON.stringify({}), 1000
      );
      db.prepare('INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
        'app2', 'sess2', 'PostToolUse', JSON.stringify({}), 2000
      );

      const projectMetrics = getProjectMetrics();

      expect(projectMetrics.length).toBeGreaterThanOrEqual(2);
      const projectNames = projectMetrics.map(p => p.project_name);
      expect(projectNames).toContain('Project1');
      expect(projectNames).toContain('Project2');
    });
  });
});
