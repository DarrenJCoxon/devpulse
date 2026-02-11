/**
 * Unit tests for ProjectOverview compaction health calculation (E4-S3)
 *
 * These tests verify the client-side health calculation logic.
 * Run with: bun test ProjectOverview.test.ts
 */

import { test, expect, describe } from "bun:test";
import type { Session } from '../types';

// Extracted functions from ProjectOverview.vue for testing
type CompactionHealth = 'green' | 'yellow' | 'red';

function getCompactionHealth(session: Session): CompactionHealth {
  if (!session.compaction_history) return 'green';

  const tenMinutesAgo = Date.now() - 600000;
  let history: number[] = [];

  try {
    history = JSON.parse(session.compaction_history);
  } catch {
    return 'green';
  }

  const recentCompactions = history.filter(ts => ts > tenMinutesAgo).length;

  if (recentCompactions >= 3) return 'red';
  if (recentCompactions >= 1) return 'yellow';
  return 'green';
}

describe("ProjectOverview - compaction health calculation", () => {
  test("returns 'green' when compaction_history has no recent entries", () => {
    const now = Date.now();
    const elevenMinutesAgo = now - (11 * 60 * 1000);

    const session: Session = {
      session_id: 'test-1',
      project_name: 'TestProject',
      source_app: 'test',
      status: 'active',
      current_branch: 'main',
      started_at: now - 3600000,
      last_event_at: now,
      event_count: 10,
      model_name: 'claude-opus-4-6',
      cwd: '/test',
      task_context: '',
      compaction_count: 1,
      last_compaction_at: elevenMinutesAgo,
      compaction_history: JSON.stringify([elevenMinutesAgo])
    };

    expect(getCompactionHealth(session)).toBe('green');
  });

  test("returns 'yellow' when 1-2 compactions in last 10 minutes", () => {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);

    const session: Session = {
      session_id: 'test-2',
      project_name: 'TestProject',
      source_app: 'test',
      status: 'active',
      current_branch: 'main',
      started_at: now - 3600000,
      last_event_at: now,
      event_count: 10,
      model_name: 'claude-opus-4-6',
      cwd: '/test',
      task_context: '',
      compaction_count: 1,
      last_compaction_at: fiveMinutesAgo,
      compaction_history: JSON.stringify([fiveMinutesAgo])
    };

    expect(getCompactionHealth(session)).toBe('yellow');
  });

  test("returns 'red' when 3+ compactions in last 10 minutes", () => {
    const now = Date.now();
    const timestamps = [
      now - (2 * 60 * 1000),
      now - (4 * 60 * 1000),
      now - (6 * 60 * 1000)
    ];

    const session: Session = {
      session_id: 'test-3',
      project_name: 'TestProject',
      source_app: 'test',
      status: 'active',
      current_branch: 'main',
      started_at: now - 3600000,
      last_event_at: now,
      event_count: 30,
      model_name: 'claude-opus-4-6',
      cwd: '/test',
      task_context: '',
      compaction_count: 3,
      last_compaction_at: timestamps[0],
      compaction_history: JSON.stringify(timestamps)
    };

    expect(getCompactionHealth(session)).toBe('red');
  });

  test("returns 'green' when compaction_history is empty", () => {
    const now = Date.now();

    const session: Session = {
      session_id: 'test-4',
      project_name: 'TestProject',
      source_app: 'test',
      status: 'active',
      current_branch: 'main',
      started_at: now - 3600000,
      last_event_at: now,
      event_count: 10,
      model_name: 'claude-opus-4-6',
      cwd: '/test',
      task_context: '',
      compaction_count: 0,
      last_compaction_at: null,
      compaction_history: '[]'
    };

    expect(getCompactionHealth(session)).toBe('green');
  });

  test("returns 'green' when compaction_history is invalid JSON", () => {
    const now = Date.now();

    const session: Session = {
      session_id: 'test-5',
      project_name: 'TestProject',
      source_app: 'test',
      status: 'active',
      current_branch: 'main',
      started_at: now - 3600000,
      last_event_at: now,
      event_count: 10,
      model_name: 'claude-opus-4-6',
      cwd: '/test',
      task_context: '',
      compaction_count: 1,
      last_compaction_at: now,
      compaction_history: 'invalid-json'
    };

    expect(getCompactionHealth(session)).toBe('green');
  });

  test("correctly filters old compactions from recent count", () => {
    const now = Date.now();
    const timestamps = [
      now - (2 * 60 * 1000),   // 2 min ago - recent
      now - (5 * 60 * 1000),   // 5 min ago - recent
      now - (15 * 60 * 1000),  // 15 min ago - old
      now - (20 * 60 * 1000)   // 20 min ago - old
    ];

    const session: Session = {
      session_id: 'test-6',
      project_name: 'TestProject',
      source_app: 'test',
      status: 'active',
      current_branch: 'main',
      started_at: now - 3600000,
      last_event_at: now,
      event_count: 40,
      model_name: 'claude-opus-4-6',
      cwd: '/test',
      task_context: '',
      compaction_count: 4,
      last_compaction_at: timestamps[0],
      compaction_history: JSON.stringify(timestamps)
    };

    // Only 2 compactions in last 10 minutes, should be yellow
    expect(getCompactionHealth(session)).toBe('yellow');
  });
});
