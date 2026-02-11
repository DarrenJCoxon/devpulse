import { test, expect, beforeAll, afterAll } from 'bun:test';
import { initDatabase, getDb, insertEvent, getEventsForSession } from './db';
import type { HookEvent } from './types';

beforeAll(() => {
  // Initialize test database
  initDatabase();
});

afterAll(() => {
  // Clean up
  const db = getDb();
  db.exec('DELETE FROM events');
  db.close();
});

test('getEventsForSession returns events in chronological order', () => {
  const db = getDb();
  db.exec('DELETE FROM events');

  const sourceApp = 'test-app';
  const sessionId = 'session-123';

  // Insert events with different timestamps
  const event1: HookEvent = {
    source_app: sourceApp,
    session_id: sessionId,
    hook_event_type: 'SessionStart',
    payload: {},
    timestamp: 1000
  };

  const event2: HookEvent = {
    source_app: sourceApp,
    session_id: sessionId,
    hook_event_type: 'PostToolUse',
    payload: { tool_name: 'Read', tool_input: { file_path: '/test.ts' } },
    timestamp: 2000
  };

  const event3: HookEvent = {
    source_app: sourceApp,
    session_id: sessionId,
    hook_event_type: 'PostToolUse',
    payload: { tool_name: 'Write', tool_input: { file_path: '/output.ts' } },
    timestamp: 3000
  };

  const event4: HookEvent = {
    source_app: sourceApp,
    session_id: sessionId,
    hook_event_type: 'SessionEnd',
    payload: {},
    timestamp: 4000
  };

  // Insert in random order
  insertEvent(event3);
  insertEvent(event1);
  insertEvent(event4);
  insertEvent(event2);

  // Fetch events
  const events = getEventsForSession(sessionId, sourceApp);

  // Should return in chronological order (ascending timestamp)
  expect(events.length).toBe(4);
  expect(events[0].hook_event_type).toBe('SessionStart');
  expect(events[0].timestamp).toBe(1000);
  expect(events[1].hook_event_type).toBe('PostToolUse');
  expect(events[1].timestamp).toBe(2000);
  expect(events[2].hook_event_type).toBe('PostToolUse');
  expect(events[2].timestamp).toBe(3000);
  expect(events[3].hook_event_type).toBe('SessionEnd');
  expect(events[3].timestamp).toBe(4000);
});

test('getEventsForSession filters by session_id and source_app', () => {
  const db = getDb();
  db.exec('DELETE FROM events');

  // Insert events for different sessions and apps
  insertEvent({
    source_app: 'app1',
    session_id: 'session1',
    hook_event_type: 'SessionStart',
    payload: {},
    timestamp: 1000
  });

  insertEvent({
    source_app: 'app2',
    session_id: 'session1',
    hook_event_type: 'SessionStart',
    payload: {},
    timestamp: 2000
  });

  insertEvent({
    source_app: 'app1',
    session_id: 'session2',
    hook_event_type: 'SessionStart',
    payload: {},
    timestamp: 3000
  });

  // Should only return events for app1:session1
  const events = getEventsForSession('session1', 'app1');
  expect(events.length).toBe(1);
  expect(events[0].source_app).toBe('app1');
  expect(events[0].session_id).toBe('session1');
});

test('getEventsForSession returns empty array for non-existent session', () => {
  const db = getDb();
  db.exec('DELETE FROM events');

  const events = getEventsForSession('non-existent', 'test-app');
  expect(events.length).toBe(0);
});

test('getEventsForSession parses JSON payload correctly', () => {
  const db = getDb();
  db.exec('DELETE FROM events');

  const event: HookEvent = {
    source_app: 'test-app',
    session_id: 'session-1',
    hook_event_type: 'PostToolUse',
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_result: 'file1.txt\nfile2.txt'
    },
    timestamp: 1000
  };

  insertEvent(event);

  const events = getEventsForSession('session-1', 'test-app');
  expect(events.length).toBe(1);
  expect(events[0].payload.tool_name).toBe('Bash');
  expect(events[0].payload.tool_input.command).toBe('ls -la');
  expect(events[0].payload.tool_result).toBe('file1.txt\nfile2.txt');
});
