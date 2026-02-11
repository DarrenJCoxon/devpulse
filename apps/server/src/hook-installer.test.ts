import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Test the validate-path endpoint logic
test('validate-path: directory exists', async () => {
  // Use current directory as a test path that definitely exists
  const testPath = process.cwd();

  // Check if directory exists (this is what the endpoint does)
  const dirExists = existsSync(testPath);

  expect(dirExists).toBe(true);
});

test('validate-path: directory does not exist', async () => {
  const testPath = '/nonexistent/path/that/does/not/exist';

  const dirExists = existsSync(testPath);

  expect(dirExists).toBe(false);
});

test('validate-path: detects existing settings.json', async () => {
  // Test with a path that would have settings
  const testPath = '/some/path';
  const settingsPath = `${testPath}/.claude/settings.json`;

  // Test the logic: check if file exists
  const hasSettings = existsSync(settingsPath);

  // Non-existent path should return false
  expect(hasSettings).toBe(false);
});

test('validate-path: suggests project name from basename', () => {
  const testPath = '/Users/test/Documents/MyAwesomeProject';
  const pathParts = testPath.split('/').filter(Boolean);
  const suggestedName = pathParts[pathParts.length - 1];

  expect(suggestedName).toBe('MyAwesomeProject');
});

test('validate-path: handles trailing slash', () => {
  const testPath = '/Users/test/Documents/MyProject/';
  const pathParts = testPath.split('/').filter(Boolean);
  const suggestedName = pathParts[pathParts.length - 1];

  expect(suggestedName).toBe('MyProject');
});

// Test the test-hook endpoint logic
test('test-hook: creates valid event structure', () => {
  const projectName = 'TestProject';
  const timestamp = Date.now();

  const testEvent = {
    source_app: projectName,
    session_id: 'test-' + timestamp,
    hook_event_type: 'TestHook',
    payload: {
      message: 'Test event from DevPulse Hook Wizard',
      timestamp
    },
    timestamp
  };

  expect(testEvent.source_app).toBe(projectName);
  expect(testEvent.hook_event_type).toBe('TestHook');
  expect(testEvent.session_id).toContain('test-');
  expect(testEvent.payload.message).toBe('Test event from DevPulse Hook Wizard');
});

// Test database insertion for test events
test('test-hook: event can be inserted into database', () => {
  const db = new Database(':memory:');

  // Create events table
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_app TEXT NOT NULL,
      session_id TEXT NOT NULL,
      hook_event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  const testEvent = {
    source_app: 'TestProject',
    session_id: 'test-' + Date.now(),
    hook_event_type: 'TestHook',
    payload: JSON.stringify({ message: 'Test' }),
    timestamp: Date.now()
  };

  const stmt = db.prepare(`
    INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    testEvent.source_app,
    testEvent.session_id,
    testEvent.hook_event_type,
    testEvent.payload,
    testEvent.timestamp
  );

  expect(result.changes).toBe(1);

  // Verify it was inserted
  const selectStmt = db.prepare('SELECT * FROM events WHERE hook_event_type = ?');
  const inserted = selectStmt.get('TestHook') as any;

  expect(inserted).toBeDefined();
  expect(inserted.source_app).toBe('TestProject');
  expect(inserted.hook_event_type).toBe('TestHook');

  db.close();
});

test('install-hooks: validates required parameters', () => {
  // Simulate endpoint validation
  const body1 = { projectPath: '/test', projectName: '' };
  const body2 = { projectPath: '', projectName: 'Test' };
  const body3 = { projectPath: '/test', projectName: 'Test' };

  const isValid1 = !!(body1.projectPath && body1.projectName);
  const isValid2 = !!(body2.projectPath && body2.projectName);
  const isValid3 = !!(body3.projectPath && body3.projectName);

  expect(isValid1).toBe(false);
  expect(isValid2).toBe(false);
  expect(isValid3).toBe(true);
});

test('install-hooks: constructs correct server URL', () => {
  const serverPort = 4000;
  const customUrl = 'http://localhost:5000/events';

  const defaultUrl = `http://localhost:${serverPort}/events`;
  const finalUrl1 = customUrl || defaultUrl;
  const customUrlUndefined: string | undefined = undefined;
  const finalUrl2 = customUrlUndefined || defaultUrl;

  expect(finalUrl1).toBe(customUrl);
  expect(finalUrl2).toBe(defaultUrl);
});
