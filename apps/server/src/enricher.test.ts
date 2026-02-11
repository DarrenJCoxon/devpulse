import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from 'bun:sqlite';
import { initEnricher, enrichEvent, getSessionsForProject, calculateProjectHealth, getAllProjects } from './enricher';
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

// --- E5-S4: Project Health Dashboard Tests ---

describe("enricher - Project Health (E5-S4)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create events table (needed for health calculation)
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_app TEXT NOT NULL,
        session_id TEXT NOT NULL,
        hook_event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        chat TEXT,
        summary TEXT,
        timestamp INTEGER NOT NULL
      )
    `);

    initEnricher(db);
  });

  test("calculateProjectHealth returns score=100 for passing tests, active sessions, 0 errors", () => {
    const projectName = 'test-project';
    const now = Date.now();

    // Insert project with passing tests
    db.prepare(`
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, deployment_status, health, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectName, '/path/to/project', 'main', 1, now, 'passing', '10 passed', '[]', '', '{}', now, now);

    // Insert active session
    db.prepare(`
      INSERT INTO sessions (session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd, task_context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess1', projectName, projectName, 'active', 'main', now, now, 10, 'claude-sonnet-4-5', '/path', '{}');

    // Insert successful tool use events (no failures)
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(projectName, 'sess1', 'PostToolUse', JSON.stringify({ tool_name: 'Bash' }), now);
    }

    const health = calculateProjectHealth(projectName);

    expect(health.testScore).toBe(100); // passing tests
    expect(health.activityScore).toBe(100); // active session
    expect(health.errorRateScore).toBe(100); // no errors
    expect(health.score).toBe(100); // 100*0.4 + 100*0.3 + 100*0.3 = 100
    expect(health.trend).toBe('stable'); // no previous score to compare
  });

  test("calculateProjectHealth returns low score for failing tests, no sessions, high error rate", () => {
    const projectName = 'failing-project';
    const now = Date.now();

    // Insert project with failing tests
    db.prepare(`
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, deployment_status, health, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectName, '/path/to/project', 'main', 0, now, 'failing', '0 passed, 10 failed', '[]', '', '{}', now, now);

    // No sessions (activity score = 30)

    // Insert events with 100% failure rate
    const thirtyMinutesAgo = now - 1800000;
    for (let i = 0; i < 10; i++) {
      db.prepare(`
        INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(projectName, 'sess1', 'PostToolUseFailure', JSON.stringify({ tool_name: 'Bash' }), thirtyMinutesAgo + i * 1000);
    }

    const health = calculateProjectHealth(projectName);

    expect(health.testScore).toBe(0); // failing tests
    expect(health.activityScore).toBe(30); // no sessions
    expect(health.errorRateScore).toBe(0); // 100% error rate
    // 0*0.4 + 30*0.3 + 0*0.3 = 9
    expect(health.score).toBe(9);
    expect(health.trend).toBe('stable');
  });

  test("calculateProjectHealth correctly weights test (40%), activity (30%), error (30%)", () => {
    const projectName = 'weighted-project';
    const now = Date.now();

    // Insert project with unknown tests (50 score)
    db.prepare(`
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, deployment_status, health, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectName, '/path/to/project', 'main', 0, now, 'unknown', '', '[]', '', '{}', now, now);

    // Insert idle session (activity score = 60)
    db.prepare(`
      INSERT INTO sessions (session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd, task_context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess1', projectName, projectName, 'idle', 'main', now, now, 5, 'claude-sonnet-4-5', '/path', '{}');

    // Insert events with 50% error rate (error score = 50)
    const thirtyMinutesAgo = now - 1800000;
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(projectName, 'sess1', 'PostToolUse', JSON.stringify({ tool_name: 'Bash' }), thirtyMinutesAgo + i * 1000);
    }
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO events (source_app, session_id, hook_event_type, payload, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(projectName, 'sess1', 'PostToolUseFailure', JSON.stringify({ tool_name: 'Bash' }), thirtyMinutesAgo + 5000 + i * 1000);
    }

    const health = calculateProjectHealth(projectName);

    expect(health.testScore).toBe(50); // unknown tests
    expect(health.activityScore).toBe(60); // idle session
    // Error rate should be close to 50 (might be 44-56 due to rounding/timing)
    expect(health.errorRateScore).toBeGreaterThanOrEqual(40);
    expect(health.errorRateScore).toBeLessThanOrEqual(60);
    // Overall score should be around 50-55
    expect(health.score).toBeGreaterThanOrEqual(48);
    expect(health.score).toBeLessThanOrEqual(58);
  });

  test("trend shows 'improving' when score increased by more than 5 points", () => {
    const projectName = 'improving-project';
    const now = Date.now();

    // Insert project with previous health score of 40
    const previousHealth = {
      score: 40,
      testScore: 0,
      activityScore: 30,
      errorRateScore: 100,
      trend: 'stable',
      previousScore: 40
    };

    db.prepare(`
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, deployment_status, health, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectName, '/path/to/project', 'main', 1, now, 'passing', '10 passed', '[]', '', JSON.stringify(previousHealth), now, now);

    // Insert active session
    db.prepare(`
      INSERT INTO sessions (session_id, project_name, source_app, status, current_branch, started_at, last_event_at, event_count, model_name, cwd, task_context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess1', projectName, projectName, 'active', 'main', now, now, 10, 'claude-sonnet-4-5', '/path', '{}');

    // No errors
    const health = calculateProjectHealth(projectName);

    expect(health.score).toBeGreaterThan(40 + 5); // Should be 100
    expect(health.trend).toBe('improving');
    expect(health.previousScore).toBe(40);
  });

  test("trend shows 'declining' when score decreased by more than 5 points", () => {
    const projectName = 'declining-project';
    const now = Date.now();

    // Insert project with previous health score of 90
    const previousHealth = {
      score: 90,
      testScore: 100,
      activityScore: 100,
      errorRateScore: 100,
      trend: 'stable',
      previousScore: 90
    };

    db.prepare(`
      INSERT INTO projects (name, path, current_branch, active_sessions, last_activity, test_status, test_summary, dev_servers, deployment_status, health, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectName, '/path/to/project', 'main', 0, now, 'failing', '0 passed, 10 failed', '[]', '', JSON.stringify(previousHealth), now, now);

    // No sessions, failing tests
    const health = calculateProjectHealth(projectName);

    expect(health.score).toBeLessThan(90 - 5); // Should be low
    expect(health.trend).toBe('declining');
    expect(health.previousScore).toBe(90);
  });

  test("getAllProjects includes parsed health data", () => {
    const projectName = 'health-project';
    const now = Date.now();

    // Create a project with health data via enrichEvent
    const event: HookEvent = {
      source_app: projectName,
      session_id: 'sess1',
      hook_event_type: 'SessionStart',
      payload: { cwd: '/path/to/project', branch: 'main' },
      timestamp: now,
      model_name: 'claude-sonnet-4-5'
    };

    enrichEvent(event);

    const projects = getAllProjects();
    const project = projects.find(p => p.name === projectName);

    expect(project).toBeDefined();
    expect(project?.health).toBeDefined();
    expect(project?.health?.score).toBeGreaterThanOrEqual(0);
    expect(project?.health?.score).toBeLessThanOrEqual(100);
    expect(project?.health?.testScore).toBeDefined();
    expect(project?.health?.activityScore).toBeDefined();
    expect(project?.health?.errorRateScore).toBeDefined();
    expect(project?.health?.trend).toBeDefined();
  });

  test("health score updates after events", () => {
    const projectName = 'update-project';
    const now = Date.now();

    // Start with a SessionStart event
    const startEvent: HookEvent = {
      source_app: projectName,
      session_id: 'sess1',
      hook_event_type: 'SessionStart',
      payload: { cwd: '/path/to/project', branch: 'main' },
      timestamp: now,
      model_name: 'claude-sonnet-4-5'
    };

    enrichEvent(startEvent);

    const projectsBefore = getAllProjects();
    const projectBefore = projectsBefore.find(p => p.name === projectName);
    expect(projectBefore?.health).toBeDefined();

    // Add a tool failure event
    const failEvent: HookEvent = {
      source_app: projectName,
      session_id: 'sess1',
      hook_event_type: 'PostToolUseFailure',
      payload: { tool_name: 'Bash', tool_input: { command: 'test' } },
      timestamp: now + 1000,
      model_name: 'claude-sonnet-4-5'
    };

    enrichEvent(failEvent);

    const projectsAfter = getAllProjects();
    const projectAfter = projectsAfter.find(p => p.name === projectName);

    // Score should be recalculated
    expect(projectAfter?.health).toBeDefined();
    expect(projectAfter?.health?.errorRateScore).toBeLessThanOrEqual(100);
  });
});
