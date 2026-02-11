/**
 * Tests for cost tracking functionality
 */

import { test, expect, describe, beforeAll } from "bun:test";
import { Database } from 'bun:sqlite';
import type { HookEvent } from './types';
import {
  initCosts,
  estimateTokensFromEvent,
  matchModelPricing,
  updateCostEstimate,
  getCostsByProject,
  getCostsBySession,
  getDailyCosts
} from './costs';

// Create an in-memory test database
let db: Database;

beforeAll(() => {
  db = new Database(':memory:');

  // Create cost_estimates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_estimates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      project_name TEXT NOT NULL,
      model_name TEXT NOT NULL,
      estimated_input_tokens INTEGER DEFAULT 0,
      estimated_output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      event_count INTEGER DEFAULT 0,
      calculated_at INTEGER NOT NULL,
      UNIQUE(session_id, source_app)
    )
  `);

  // Create sessions table (for join in getCostsBySession)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_event_at INTEGER NOT NULL,
      UNIQUE(session_id, source_app)
    )
  `);

  initCosts(db);
});

describe('estimateTokensFromEvent', () => {
  test('returns reasonable estimates for a typical PostToolUse event', () => {
    const event: HookEvent = {
      source_app: 'test-app',
      session_id: 'test-session',
      hook_event_type: 'PostToolUse',
      payload: {
        tool_name: 'Read',
        tool_input: { file_path: '/path/to/file.ts' },
        tool_result: 'File content here with some reasonable length to simulate output',
        cwd: '/project/path'
      }
    };

    const { input, output } = estimateTokensFromEvent(event);

    // Should have base overhead + payload tokens
    expect(input).toBeGreaterThan(500); // At least the base overhead
    expect(input).toBeLessThan(2000);   // Reasonable upper bound

    // Should have output tokens from tool result
    expect(output).toBeGreaterThan(0);
    expect(output).toBeLessThan(500);
  });

  test('estimates higher input tokens for chat-heavy events', () => {
    const event: HookEvent = {
      source_app: 'test-app',
      session_id: 'test-session',
      hook_event_type: 'UserPromptSubmit',
      payload: {
        prompt: 'User input here'
      },
      chat: [
        { role: 'user', content: 'Previous message 1' },
        { role: 'assistant', content: 'Previous response 1' },
        { role: 'user', content: 'Previous message 2' }
      ]
    };

    const { input, output } = estimateTokensFromEvent(event);

    // Should include chat history tokens
    expect(input).toBeGreaterThan(500);
    expect(output).toBe(0); // No output for UserPromptSubmit
  });
});

describe('matchModelPricing', () => {
  test('correctly matches "claude-opus-4-6" to Opus pricing', () => {
    const pricing = matchModelPricing('claude-opus-4-6');

    expect(pricing.display_name).toBe('Opus 4.6');
    expect(pricing.input_per_1m).toBe(15);
    expect(pricing.output_per_1m).toBe(75);
  });

  test('correctly matches "claude-sonnet-4-5-20250929" to Sonnet pricing', () => {
    const pricing = matchModelPricing('claude-sonnet-4-5-20250929');

    expect(pricing.display_name).toBe('Sonnet 4.5');
    expect(pricing.input_per_1m).toBe(3);
    expect(pricing.output_per_1m).toBe(15);
  });

  test('correctly matches "claude-haiku-4-5" to Haiku pricing', () => {
    const pricing = matchModelPricing('claude-haiku-4-5');

    expect(pricing.display_name).toBe('Haiku 4.5');
    expect(pricing.input_per_1m).toBe(0.80);
    expect(pricing.output_per_1m).toBe(4);
  });

  test('returns Sonnet as default for unknown model names', () => {
    const pricing = matchModelPricing('unknown-model-xyz');

    expect(pricing.display_name).toBe('Sonnet 4.5');
    expect(pricing.input_per_1m).toBe(3);
    expect(pricing.output_per_1m).toBe(15);
  });

  test('handles empty model name gracefully', () => {
    const pricing = matchModelPricing('');

    expect(pricing.display_name).toBe('Sonnet 4.5');
  });
});

describe('updateCostEstimate', () => {
  test('creates new cost estimate for first event', () => {
    const sessionId = 'session-1';
    const sourceApp = 'app-1';
    const projectName = 'project-1';
    const modelName = 'claude-sonnet-4-5';

    updateCostEstimate(sessionId, sourceApp, projectName, modelName, 1000, 500);

    const row = db.prepare(
      'SELECT * FROM cost_estimates WHERE session_id = ? AND source_app = ?'
    ).get(sessionId, sourceApp) as any;

    expect(row).toBeDefined();
    expect(row.estimated_input_tokens).toBe(1000);
    expect(row.estimated_output_tokens).toBe(500);
    expect(row.event_count).toBe(1);
    expect(row.estimated_cost_usd).toBeGreaterThan(0);
  });

  test('accumulates tokens on subsequent events', () => {
    const sessionId = 'session-2';
    const sourceApp = 'app-2';
    const projectName = 'project-2';
    const modelName = 'claude-opus-4-6';

    // First event
    updateCostEstimate(sessionId, sourceApp, projectName, modelName, 1000, 500);

    // Second event
    updateCostEstimate(sessionId, sourceApp, projectName, modelName, 800, 300);

    const row = db.prepare(
      'SELECT * FROM cost_estimates WHERE session_id = ? AND source_app = ?'
    ).get(sessionId, sourceApp) as any;

    expect(row.estimated_input_tokens).toBe(1800);
    expect(row.estimated_output_tokens).toBe(800);
    expect(row.event_count).toBe(2);
  });
});

describe('getCostsByProject', () => {
  test('correctly aggregates costs across sessions', () => {
    // Clean up and set up test data
    db.exec('DELETE FROM cost_estimates');

    const now = Date.now();

    // Add costs for multiple sessions in the same project
    updateCostEstimate('session-a', 'app-test', 'project-aggregate', 'claude-sonnet-4-5', 10000, 5000);
    updateCostEstimate('session-b', 'app-test', 'project-aggregate', 'claude-sonnet-4-5', 15000, 7000);
    updateCostEstimate('session-c', 'app-test', 'other-project', 'claude-opus-4-6', 20000, 10000);

    const costs = getCostsByProject();

    // Should have 2 projects
    expect(costs.length).toBe(2);

    // Find project-aggregate
    const projectCost = costs.find(c => c.project_name === 'project-aggregate');
    expect(projectCost).toBeDefined();
    expect(projectCost!.session_count).toBe(2);
    expect(projectCost!.total_input_tokens).toBe(25000);
    expect(projectCost!.total_output_tokens).toBe(12000);
    expect(projectCost!.total_cost_usd).toBeGreaterThan(0);
  });
});

describe('getCostsBySession', () => {
  test('returns per-session costs for a project', () => {
    // Clean up and set up test data
    db.exec('DELETE FROM cost_estimates');
    db.exec('DELETE FROM sessions');

    const now = Date.now();

    // Add session records
    db.prepare('INSERT INTO sessions (session_id, source_app, started_at, last_event_at) VALUES (?, ?, ?, ?)')
      .run('session-x', 'app-x', now - 60000, now);
    db.prepare('INSERT INTO sessions (session_id, source_app, started_at, last_event_at) VALUES (?, ?, ?, ?)')
      .run('session-y', 'app-x', now - 120000, now);

    // Add cost estimates
    updateCostEstimate('session-x', 'app-x', 'project-x', 'claude-sonnet-4-5', 5000, 2000);
    updateCostEstimate('session-y', 'app-x', 'project-x', 'claude-opus-4-6', 8000, 3000);

    const costs = getCostsBySession('project-x');

    expect(costs.length).toBe(2);

    // Should be sorted by cost descending
    if (costs.length >= 2) {
      expect(costs[0]?.estimated_cost_usd).toBeGreaterThanOrEqual(costs[1]?.estimated_cost_usd ?? 0);
    }

    // Check session details
    const sessionX = costs.find(c => c.session_id === 'session-x');
    expect(sessionX).toBeDefined();
    if (sessionX) {
      expect(sessionX.estimated_input_tokens).toBe(5000);
      expect(sessionX.estimated_output_tokens).toBe(2000);
      expect(sessionX.model_name).toBe('claude-sonnet-4-5');
    }
  });
});

describe('getDailyCosts', () => {
  test('returns 7 entries for 7 days', () => {
    // Clean up
    db.exec('DELETE FROM cost_estimates');

    const now = Date.now();

    // Add costs for today and 2 days ago
    updateCostEstimate('session-today', 'app-daily', 'project-daily', 'claude-sonnet-4-5', 5000, 2000);

    // Manually insert a cost from 2 days ago
    const twoDaysAgo = now - (2 * 86400000);
    db.prepare(`
      INSERT INTO cost_estimates (session_id, source_app, project_name, model_name, estimated_input_tokens, estimated_output_tokens, estimated_cost_usd, event_count, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('session-old', 'app-daily', 'project-daily', 'claude-sonnet-4-5', 3000, 1000, 0.015, 1, twoDaysAgo);

    const costs = getDailyCosts(7);

    expect(costs.length).toBe(7);

    // Should have dates in ascending order (dates are ISO strings, so lexicographic sort works)
    for (let i = 1; i < costs.length; i++) {
      const current = costs[i];
      const previous = costs[i - 1];
      if (current && previous) {
        expect(current.date >= previous.date).toBe(true);
      }
    }

    // Days without costs should have zero total
    const zeroCostDays = costs.filter(c => c.total_cost_usd === 0);
    expect(zeroCostDays.length).toBeGreaterThan(0);

    // Today should have costs
    const today = costs[costs.length - 1];
    if (today) {
      expect(today.total_cost_usd).toBeGreaterThan(0);
    }
  });
});
