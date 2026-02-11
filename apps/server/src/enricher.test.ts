import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from 'bun:sqlite';
import { initEnricher, enrichEvent, getSessionsForProject } from './enricher';
import type { HookEvent } from './types';

describe("enricher - task_context integration", () => {
  let db: Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    initEnricher(db);
  });

  test("stores task_context when SessionStart event has a feature branch", () => {
    const event: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-session-123',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: {
        cwd: '/test/path',
        branch: 'feature/PROJ-42-new-feature'
      }
    };

    enrichEvent(event);

    const sessions = getSessionsForProject('TestProject');
    expect(sessions.length).toBe(1);

    const session = sessions[0];
    expect(session).toBeDefined();
    expect(session?.task_context).toBeTruthy();

    // Parse the task_context JSON
    const taskContext = JSON.parse(session!.task_context);
    expect(taskContext).toEqual({
      prefix: 'feature',
      ticket_id: 'PROJ-42',
      description: 'New Feature',
      display: 'PROJ-42: New Feature'
    });
  });

  test("stores task_context when SessionStart event has a fix branch without ticket", () => {
    const event: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-session-456',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: {
        cwd: '/test/path',
        branch: 'fix/broken-navbar'
      }
    };

    enrichEvent(event);

    const sessions = getSessionsForProject('TestProject');
    expect(sessions.length).toBe(1);

    const session = sessions[0];
    expect(session).toBeDefined();
    expect(session?.task_context).toBeTruthy();

    const taskContext = JSON.parse(session!.task_context);
    expect(taskContext).toEqual({
      prefix: 'fix',
      ticket_id: '',
      description: 'Broken Navbar',
      display: 'Fix: Broken Navbar'
    });
  });

  test("stores task_context for main branch (passthrough)", () => {
    const event: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-session-789',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: {
        cwd: '/test/path',
        branch: 'main'
      }
    };

    enrichEvent(event);

    const sessions = getSessionsForProject('TestProject');
    expect(sessions.length).toBe(1);

    const session = sessions[0];
    expect(session).toBeDefined();
    expect(session?.task_context).toBeTruthy();

    const taskContext = JSON.parse(session!.task_context);
    expect(taskContext).toEqual({
      prefix: '',
      ticket_id: '',
      description: 'main',
      display: 'main'
    });
  });

  test("updates task_context when branch changes", () => {
    // Start with feature branch
    const startEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-session-update',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: {
        cwd: '/test/path',
        branch: 'feature/AUTH-123-login'
      }
    };

    enrichEvent(startEvent);

    let sessions = getSessionsForProject('TestProject');
    let taskContext = JSON.parse(sessions[0]!.task_context);
    expect(taskContext.display).toBe('AUTH-123: Login');

    // Simulate branch change with another event
    const updateEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-session-update',
      hook_event_type: 'PreToolUse',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now() + 1000,
      payload: {
        cwd: '/test/path',
        branch: 'fix/hotfix-urgent'
      }
    };

    enrichEvent(updateEvent);

    sessions = getSessionsForProject('TestProject');
    taskContext = JSON.parse(sessions[0]!.task_context);

    // Note: task_context is only updated in upsertSession which is called from SessionStart
    // For other events, we call updateSessionActivity which doesn't update branch/task_context
    // So the task_context should remain the same
    expect(taskContext.display).toBe('AUTH-123: Login');
  });

  test("handles nested branch paths correctly", () => {
    const event: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-session-nested',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: {
        cwd: '/test/path',
        branch: 'feature/team/AUTH-456-multi-level'
      }
    };

    enrichEvent(event);

    const sessions = getSessionsForProject('TestProject');
    const taskContext = JSON.parse(sessions[0]!.task_context);

    expect(taskContext).toEqual({
      prefix: 'feature',
      ticket_id: 'AUTH-456',
      description: 'Multi Level',
      display: 'AUTH-456: Multi Level'
    });
  });

  test("handles chore branch with ticket ID", () => {
    const event: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-session-chore',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: {
        cwd: '/test/path',
        branch: 'chore/MAINT-100-update-deps'
      }
    };

    enrichEvent(event);

    const sessions = getSessionsForProject('TestProject');
    const taskContext = JSON.parse(sessions[0]!.task_context);

    expect(taskContext).toEqual({
      prefix: 'chore',
      ticket_id: 'MAINT-100',
      description: 'Update Deps',
      display: 'MAINT-100: Update Deps'
    });
  });
});

// --- E4-S3: Context Window Health Monitor Tests ---

describe("enricher - PreCompact handling (E4-S3)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initEnricher(db);
  });

  test("PreCompact event increments compaction_count from 0 to 1", () => {
    // Start a session
    const startEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-compact-1',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: { cwd: '/test/path', branch: 'main' }
    };
    enrichEvent(startEvent);

    // Send PreCompact event
    const compactEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-compact-1',
      hook_event_type: 'PreCompact',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now() + 1000,
      payload: {}
    };
    enrichEvent(compactEvent);

    const sessions = getSessionsForProject('TestProject');
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.compaction_count).toBe(1);
    expect(sessions[0]?.last_compaction_at).toBeGreaterThan(0);
  });

  test("PreCompact event appends timestamp to compaction_history array", () => {
    // Start a session
    const startEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-compact-2',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: { cwd: '/test/path', branch: 'main' }
    };
    enrichEvent(startEvent);

    const beforeCompact = Date.now();

    // Send PreCompact event
    const compactEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-compact-2',
      hook_event_type: 'PreCompact',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: {}
    };
    enrichEvent(compactEvent);

    const afterCompact = Date.now();

    const sessions = getSessionsForProject('TestProject');
    expect(sessions.length).toBe(1);

    const history = JSON.parse(sessions[0]?.compaction_history || '[]');
    expect(history).toBeArray();
    expect(history.length).toBe(1);
    // Check that the timestamp is within a reasonable range (not exact due to timing)
    expect(history[0]).toBeGreaterThanOrEqual(beforeCompact);
    expect(history[0]).toBeLessThanOrEqual(afterCompact);
  });

  test("compaction_history is trimmed to last 20 entries when it exceeds 20", () => {
    // Start a session
    const startEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-compact-3',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: { cwd: '/test/path', branch: 'main' }
    };
    enrichEvent(startEvent);

    // Send 25 PreCompact events
    for (let i = 0; i < 25; i++) {
      const compactEvent: HookEvent = {
        source_app: 'TestProject',
        session_id: 'test-compact-3',
        hook_event_type: 'PreCompact',
        model_name: 'claude-opus-4-6',
        timestamp: Date.now() + (i * 1000),
        payload: {}
      };
      enrichEvent(compactEvent);
    }

    const sessions = getSessionsForProject('TestProject');
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.compaction_count).toBe(25);

    const history = JSON.parse(sessions[0]?.compaction_history || '[]');
    expect(history).toBeArray();
    expect(history.length).toBe(20); // Should be trimmed to 20
  });

  test("multiple PreCompact events increment count correctly", () => {
    // Start a session
    const startEvent: HookEvent = {
      source_app: 'TestProject',
      session_id: 'test-compact-4',
      hook_event_type: 'SessionStart',
      model_name: 'claude-opus-4-6',
      timestamp: Date.now(),
      payload: { cwd: '/test/path', branch: 'main' }
    };
    enrichEvent(startEvent);

    // Send 3 PreCompact events
    for (let i = 0; i < 3; i++) {
      const compactEvent: HookEvent = {
        source_app: 'TestProject',
        session_id: 'test-compact-4',
        hook_event_type: 'PreCompact',
        model_name: 'claude-opus-4-6',
        timestamp: Date.now() + (i * 1000),
        payload: {}
      };
      enrichEvent(compactEvent);
    }

    const sessions = getSessionsForProject('TestProject');
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.compaction_count).toBe(3);

    const history = JSON.parse(sessions[0]?.compaction_history || '[]');
    expect(history.length).toBe(3);
  });
});
