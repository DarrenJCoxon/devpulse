import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from 'bun:sqlite';
import { initSummaries, getDailySummary, getWeeklySummary, aggregateDevLogs, calculateTotals } from './summaries';
import type { DevLog, ProjectSummary } from './types';

describe("summaries - daily summary aggregation", () => {
  let db: Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Create dev_logs table
    db.exec(`
      CREATE TABLE IF NOT EXISTS dev_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        branch TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        files_changed TEXT DEFAULT '[]',
        commits TEXT DEFAULT '[]',
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_minutes REAL DEFAULT 0,
        event_count INTEGER DEFAULT 0,
        tool_breakdown TEXT DEFAULT '{}'
      )
    `);

    initSummaries(db);
  });

  test("getDailySummary correctly aggregates 3 dev logs from 2 projects", () => {
    const date = '2026-02-11';
    const dateObj = new Date(date + 'T00:00:00.000Z');
    const baseTimestamp = dateObj.getTime();

    // Insert 3 dev logs: 2 from ProjectA, 1 from ProjectB
    db.prepare(`
      INSERT INTO dev_logs (session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-1',
      'ProjectA',
      'feature/test-1',
      'Implemented feature X',
      JSON.stringify(['/src/app.ts', '/src/utils.ts']),
      JSON.stringify(['Add feature X']),
      baseTimestamp,
      baseTimestamp + 3600000, // 1 hour
      60,
      50,
      JSON.stringify({ Read: 10, Write: 5, Bash: 3 })
    );

    db.prepare(`
      INSERT INTO dev_logs (session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-2',
      'ProjectA',
      'feature/test-1',
      'Fixed bug in feature X',
      JSON.stringify(['/src/utils.ts', '/src/config.ts']),
      JSON.stringify(['Fix bug in X']),
      baseTimestamp + 7200000,
      baseTimestamp + 10800000, // 1 hour later
      60,
      30,
      JSON.stringify({ Read: 5, Edit: 8, Bash: 2 })
    );

    db.prepare(`
      INSERT INTO dev_logs (session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-3',
      'ProjectB',
      'main',
      'Updated docs',
      JSON.stringify(['/README.md']),
      JSON.stringify(['Update documentation']),
      baseTimestamp + 14400000,
      baseTimestamp + 16200000, // 30 min
      30,
      15,
      JSON.stringify({ Read: 2, Write: 3 })
    );

    const summary = getDailySummary(date);

    // Verify summary structure
    expect(summary.period).toBe('daily');
    expect(summary.start_date).toBe(date);
    expect(summary.end_date).toBe(date);
    expect(summary.projects.length).toBe(2);

    // Verify totals
    expect(summary.totals.total_sessions).toBe(3);
    expect(summary.totals.total_duration_minutes).toBe(150); // 60 + 60 + 30
    expect(summary.totals.total_commits).toBe(3);
    expect(summary.totals.active_projects).toBe(2);
    expect(summary.totals.total_files_changed).toBe(4); // Deduplicated across all projects

    // Verify ProjectA aggregation
    const projectA = summary.projects.find(p => p.project_name === 'ProjectA');
    expect(projectA).toBeDefined();
    expect(projectA?.session_count).toBe(2);
    expect(projectA?.total_duration_minutes).toBe(120);
    expect(projectA?.files_changed.length).toBe(3); // Deduplicated: app.ts, utils.ts, config.ts
    expect(projectA?.commit_count).toBe(2);
    expect(projectA?.tool_breakdown.Read).toBe(15); // 10 + 5
    expect(projectA?.tool_breakdown.Write).toBe(5);
    expect(projectA?.tool_breakdown.Edit).toBe(8);
    expect(projectA?.tool_breakdown.Bash).toBe(5); // 3 + 2

    // Verify ProjectB aggregation
    const projectB = summary.projects.find(p => p.project_name === 'ProjectB');
    expect(projectB).toBeDefined();
    expect(projectB?.session_count).toBe(1);
    expect(projectB?.total_duration_minutes).toBe(30);
    expect(projectB?.files_changed.length).toBe(1);
    expect(projectB?.commit_count).toBe(1);
  });

  test("getDailySummary for a date with no logs returns empty projects array and zero totals", () => {
    const date = '2026-02-11';
    const summary = getDailySummary(date);

    expect(summary.period).toBe('daily');
    expect(summary.start_date).toBe(date);
    expect(summary.end_date).toBe(date);
    expect(summary.projects.length).toBe(0);
    expect(summary.totals.total_sessions).toBe(0);
    expect(summary.totals.total_duration_minutes).toBe(0);
    expect(summary.totals.total_commits).toBe(0);
    expect(summary.totals.total_files_changed).toBe(0);
    expect(summary.totals.active_projects).toBe(0);
  });
});

describe("summaries - weekly summary aggregation", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');

    db.exec(`
      CREATE TABLE IF NOT EXISTS dev_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        branch TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        files_changed TEXT DEFAULT '[]',
        commits TEXT DEFAULT '[]',
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_minutes REAL DEFAULT 0,
        event_count INTEGER DEFAULT 0,
        tool_breakdown TEXT DEFAULT '{}'
      )
    `);

    initSummaries(db);
  });

  test("getWeeklySummary correctly spans Monday-Sunday and aggregates across days", () => {
    // 2026-W07 is Feb 9-15, 2026 (Monday to Sunday)
    const isoWeek = '2026-W07';

    // Insert logs on Monday (Feb 9), Wednesday (Feb 11), and Sunday (Feb 15)
    const monday = new Date('2026-02-09T12:00:00.000Z').getTime();
    const wednesday = new Date('2026-02-11T14:00:00.000Z').getTime();
    const sunday = new Date('2026-02-15T16:00:00.000Z').getTime();

    db.prepare(`
      INSERT INTO dev_logs (session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-monday',
      'ProjectA',
      'main',
      'Monday work',
      JSON.stringify(['/file1.ts']),
      JSON.stringify(['Monday commit']),
      monday - 3600000,
      monday,
      60,
      20,
      JSON.stringify({ Read: 5, Write: 3 })
    );

    db.prepare(`
      INSERT INTO dev_logs (session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-wednesday',
      'ProjectA',
      'main',
      'Wednesday work',
      JSON.stringify(['/file2.ts']),
      JSON.stringify(['Wednesday commit']),
      wednesday - 3600000,
      wednesday,
      90,
      30,
      JSON.stringify({ Read: 8, Edit: 4 })
    );

    db.prepare(`
      INSERT INTO dev_logs (session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-sunday',
      'ProjectB',
      'feature/test',
      'Sunday work',
      JSON.stringify(['/file3.ts']),
      JSON.stringify(['Sunday commit']),
      sunday - 1800000,
      sunday,
      30,
      10,
      JSON.stringify({ Bash: 2, Write: 1 })
    );

    const summary = getWeeklySummary(isoWeek);

    expect(summary.period).toBe('weekly');
    expect(summary.start_date).toBe('2026-02-09');
    expect(summary.end_date).toBe('2026-02-15');
    expect(summary.projects.length).toBe(2);
    expect(summary.totals.total_sessions).toBe(3);
    expect(summary.totals.total_duration_minutes).toBe(180); // 60 + 90 + 30
    expect(summary.totals.active_projects).toBe(2);

    const projectA = summary.projects.find(p => p.project_name === 'ProjectA');
    expect(projectA?.session_count).toBe(2);
    expect(projectA?.total_duration_minutes).toBe(150);
  });
});

describe("summaries - helper functions", () => {
  test("aggregateDevLogs correctly merges tool breakdowns (sums counts)", () => {
    const logs: DevLog[] = [
      {
        id: 1,
        session_id: 'sess-1',
        project_name: 'TestProject',
        branch: 'main',
        summary: 'Test 1',
        files_changed: JSON.stringify(['/file1.ts']),
        commits: JSON.stringify(['Commit 1']),
        started_at: Date.now(),
        ended_at: Date.now(),
        duration_minutes: 30,
        event_count: 10,
        tool_breakdown: JSON.stringify({ Read: 5, Write: 3 })
      },
      {
        id: 2,
        session_id: 'sess-2',
        project_name: 'TestProject',
        branch: 'main',
        summary: 'Test 2',
        files_changed: JSON.stringify(['/file2.ts']),
        commits: JSON.stringify(['Commit 2']),
        started_at: Date.now(),
        ended_at: Date.now(),
        duration_minutes: 45,
        event_count: 15,
        tool_breakdown: JSON.stringify({ Read: 8, Edit: 4, Bash: 2 })
      }
    ];

    const projects = aggregateDevLogs(logs);

    expect(projects.length).toBe(1);
    expect(projects[0]!.project_name).toBe('TestProject');
    expect(projects[0]!.tool_breakdown.Read).toBe(13); // 5 + 8
    expect(projects[0]!.tool_breakdown.Write).toBe(3);
    expect(projects[0]!.tool_breakdown.Edit).toBe(4);
    expect(projects[0]!.tool_breakdown.Bash).toBe(2);
  });

  test("aggregateDevLogs correctly deduplicates file paths", () => {
    const logs: DevLog[] = [
      {
        id: 1,
        session_id: 'sess-1',
        project_name: 'TestProject',
        branch: 'main',
        summary: 'Test 1',
        files_changed: JSON.stringify(['/file1.ts', '/file2.ts']),
        commits: JSON.stringify([]),
        started_at: Date.now(),
        ended_at: Date.now(),
        duration_minutes: 30,
        event_count: 10,
        tool_breakdown: JSON.stringify({})
      },
      {
        id: 2,
        session_id: 'sess-2',
        project_name: 'TestProject',
        branch: 'main',
        summary: 'Test 2',
        files_changed: JSON.stringify(['/file2.ts', '/file3.ts']),
        commits: JSON.stringify([]),
        started_at: Date.now(),
        ended_at: Date.now(),
        duration_minutes: 30,
        event_count: 10,
        tool_breakdown: JSON.stringify({})
      }
    ];

    const projects = aggregateDevLogs(logs);

    expect(projects.length).toBe(1);
    expect(projects[0]!.files_changed.length).toBe(3);
    expect(projects[0]!.files_changed).toContain('/file1.ts');
    expect(projects[0]!.files_changed).toContain('/file2.ts');
    expect(projects[0]!.files_changed).toContain('/file3.ts');
  });

  test("calculateTotals computes correct cross-project aggregates", () => {
    const projects: ProjectSummary[] = [
      {
        project_name: 'ProjectA',
        session_count: 2,
        total_duration_minutes: 100,
        files_changed: ['/a1.ts', '/a2.ts', '/shared.ts'],
        commit_count: 3,
        commits: ['A1', 'A2', 'A3'],
        tool_breakdown: { Read: 10 },
        dev_logs: []
      },
      {
        project_name: 'ProjectB',
        session_count: 1,
        total_duration_minutes: 50,
        files_changed: ['/b1.ts', '/shared.ts'],
        commit_count: 1,
        commits: ['B1'],
        tool_breakdown: { Write: 5 },
        dev_logs: []
      }
    ];

    const totals = calculateTotals(projects);

    expect(totals.total_sessions).toBe(3);
    expect(totals.total_duration_minutes).toBe(150);
    expect(totals.total_commits).toBe(4);
    expect(totals.active_projects).toBe(2);
    expect(totals.total_files_changed).toBe(4); // Deduplicated: a1, a2, b1, shared
  });
});
