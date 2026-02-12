/**
 * DevPulse Cost Tracking
 *
 * Estimates token usage and API costs from hook events.
 * Since actual token counts are not available, estimates based on:
 * - Payload size (JSON.stringify length / 4 for char-to-token ratio)
 * - Tool result sizes from PostToolUse events
 * - Per-event overhead (~500 tokens for system prompt/context)
 */

import { Database } from 'bun:sqlite';
import type {
  HookEvent,
  ModelPricing,
  DEFAULT_PRICING,
  ProjectCost,
  SessionCost,
  DailyCost
} from './types';

let db: Database;

// Import DEFAULT_PRICING constant
const PRICING: ModelPricing[] = [
  { model_pattern: 'opus', input_per_1m: 15, output_per_1m: 75, display_name: 'Opus 4.6' },
  { model_pattern: 'sonnet', input_per_1m: 3, output_per_1m: 15, display_name: 'Sonnet 4.5' },
  { model_pattern: 'haiku', input_per_1m: 0.80, output_per_1m: 4, display_name: 'Haiku 4.5' },
];

export function initCosts(database: Database): void {
  db = database;
}

/**
 * Estimate token counts from a hook event.
 * Returns estimated input and output tokens.
 */
export function estimateTokensFromEvent(event: HookEvent): { input: number; output: number } {
  const payload = event.payload || {};

  // Base overhead per event for system prompt and context
  const BASE_OVERHEAD = 500;

  // Estimate input tokens from payload size
  const payloadStr = JSON.stringify(payload);
  const payloadChars = payloadStr.length;
  // Rough estimate: 4 chars per token
  const payloadTokens = Math.ceil(payloadChars / 4);

  let inputTokens = payloadTokens + BASE_OVERHEAD;
  let outputTokens = 0;

  // For PostToolUse events, estimate output tokens from tool result
  if (event.hook_event_type === 'PostToolUse') {
    const toolResult = payload.tool_result || payload.output || '';
    const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
    const resultChars = resultStr.length;
    outputTokens = Math.ceil(resultChars / 4);
  }

  // For chat-heavy events (UserPromptSubmit, Notification), estimate higher input
  if (event.hook_event_type === 'UserPromptSubmit' || event.hook_event_type === 'Notification') {
    const chatStr = JSON.stringify(event.chat || []);
    const chatTokens = Math.ceil(chatStr.length / 4);
    inputTokens += chatTokens;
  }

  return { input: inputTokens, output: outputTokens };
}

/**
 * Match a model name to a pricing tier.
 * Returns the matching pricing or defaults to Sonnet if unknown.
 */
export function matchModelPricing(modelName: string): ModelPricing {
  const normalized = (modelName || '').toLowerCase();

  for (const pricing of PRICING) {
    if (normalized.includes(pricing.model_pattern.toLowerCase())) {
      return pricing;
    }
  }

  // Default to Sonnet pricing for unknown models
  const defaultPricing = PRICING[1]; // Sonnet
  if (!defaultPricing) {
    throw new Error('Default pricing configuration is missing');
  }
  return defaultPricing;
}

/**
 * Calculate cost in USD from token counts and model pricing.
 */
function calculateCost(inputTokens: number, outputTokens: number, pricing: ModelPricing): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.input_per_1m;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_per_1m;
  return inputCost + outputCost;
}

/**
 * Update or insert cost estimate for a session.
 * Called on every event to accumulate token estimates and recalculate cost.
 */
export function updateCostEstimate(
  sessionId: string,
  sourceApp: string,
  projectName: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number
): void {
  const now = Date.now();

  // Get existing cost estimate if it exists
  const existing = db.prepare(`
    SELECT id, session_id, source_app, project_name, model_name,
           estimated_input_tokens, estimated_output_tokens, estimated_cost_usd, event_count
    FROM cost_estimates
    WHERE session_id = ? AND source_app = ?
  `).get(sessionId, sourceApp) as any;

  if (existing) {
    // Accumulate tokens
    const newInputTokens = existing.estimated_input_tokens + inputTokens;
    const newOutputTokens = existing.estimated_output_tokens + outputTokens;
    const newEventCount = existing.event_count + 1;

    // Recalculate cost with updated model name (in case it changed)
    const pricing = matchModelPricing(modelName || existing.model_name);
    const newCost = calculateCost(newInputTokens, newOutputTokens, pricing);

    db.prepare(`
      UPDATE cost_estimates
      SET estimated_input_tokens = ?,
          estimated_output_tokens = ?,
          estimated_cost_usd = ?,
          event_count = ?,
          model_name = ?,
          calculated_at = ?
      WHERE session_id = ? AND source_app = ?
    `).run(
      newInputTokens,
      newOutputTokens,
      newCost,
      newEventCount,
      modelName || existing.model_name,
      now,
      sessionId,
      sourceApp
    );
  } else {
    // Create new cost estimate
    const pricing = matchModelPricing(modelName);
    const cost = calculateCost(inputTokens, outputTokens, pricing);

    db.prepare(`
      INSERT INTO cost_estimates (
        session_id, source_app, project_name, model_name,
        estimated_input_tokens, estimated_output_tokens, estimated_cost_usd,
        event_count, calculated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      sourceApp,
      projectName,
      modelName,
      inputTokens,
      outputTokens,
      cost,
      1,
      now
    );
  }
}

/**
 * Get cost totals aggregated by project.
 * Optionally filter by date range.
 */
export function getCostsByProject(startDate?: number, endDate?: number): ProjectCost[] {
  // Single query that fetches both project totals and model distribution via GROUP BY
  let query = `
    SELECT
      project_name,
      model_name,
      SUM(estimated_cost_usd) as total_cost_usd,
      SUM(estimated_input_tokens) as total_input_tokens,
      SUM(estimated_output_tokens) as total_output_tokens,
      COUNT(DISTINCT session_id || ':' || source_app) as session_count
    FROM cost_estimates
  `;

  const params: any[] = [];
  const conditions: string[] = [];

  if (startDate !== undefined) {
    conditions.push('calculated_at >= ?');
    params.push(startDate);
  }

  if (endDate !== undefined) {
    conditions.push('calculated_at <= ?');
    params.push(endDate);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' GROUP BY project_name, model_name ORDER BY project_name, total_cost_usd DESC';

  const rows = db.prepare(query).all(...params) as any[];

  // Aggregate rows by project_name
  const projectMap = new Map<string, ProjectCost>();

  for (const row of rows) {
    let project = projectMap.get(row.project_name);
    if (!project) {
      project = {
        project_name: row.project_name,
        total_cost_usd: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        session_count: 0,
        model_distribution: {}
      };
      projectMap.set(row.project_name, project);
    }

    project.total_cost_usd += row.total_cost_usd || 0;
    project.total_input_tokens += row.total_input_tokens || 0;
    project.total_output_tokens += row.total_output_tokens || 0;
    project.session_count += row.session_count || 0;
    project.model_distribution[row.model_name] = row.session_count || 0;
  }

  // Sort by total cost descending
  return Array.from(projectMap.values()).sort((a, b) => b.total_cost_usd - a.total_cost_usd);
}

/**
 * Get per-session cost breakdown for a project.
 */
export function getCostsBySession(projectName: string): SessionCost[] {
  const query = `
    SELECT
      ce.session_id,
      ce.source_app,
      ce.model_name,
      ce.estimated_input_tokens,
      ce.estimated_output_tokens,
      ce.estimated_cost_usd,
      ce.event_count,
      s.started_at,
      CAST((s.last_event_at - s.started_at) / 60000 AS INTEGER) as duration_minutes
    FROM cost_estimates ce
    LEFT JOIN sessions s ON ce.session_id = s.session_id AND ce.source_app = s.source_app
    WHERE ce.project_name = ?
    ORDER BY ce.estimated_cost_usd DESC
  `;

  const rows = db.prepare(query).all(projectName) as any[];

  return rows.map(row => ({
    session_id: row.session_id,
    source_app: row.source_app,
    model_name: row.model_name,
    estimated_input_tokens: row.estimated_input_tokens || 0,
    estimated_output_tokens: row.estimated_output_tokens || 0,
    estimated_cost_usd: row.estimated_cost_usd || 0,
    event_count: row.event_count || 0,
    started_at: row.started_at || 0,
    duration_minutes: row.duration_minutes || 0
  }));
}

/**
 * Get daily cost aggregates for the last N days.
 */
export function getDailyCosts(days: number): DailyCost[] {
  const now = Date.now();
  const daysAgo = now - (days * 86400000); // days * milliseconds per day

  // Get all cost estimates in the date range
  const query = `
    SELECT
      date(calculated_at / 1000, 'unixepoch') as date,
      project_name,
      SUM(estimated_cost_usd) as cost
    FROM cost_estimates
    WHERE calculated_at >= ?
    GROUP BY date, project_name
    ORDER BY date ASC
  `;

  const rows = db.prepare(query).all(daysAgo) as any[];

  // Group by date and build project cost map
  const dailyCostMap = new Map<string, DailyCost>();

  for (const row of rows) {
    const dateStr = String(row.date);
    if (!dailyCostMap.has(dateStr)) {
      dailyCostMap.set(dateStr, {
        date: dateStr,
        total_cost_usd: 0,
        projects: {}
      });
    }

    const dailyCost = dailyCostMap.get(dateStr);
    if (dailyCost) {
      dailyCost.total_cost_usd += row.cost || 0;
      dailyCost.projects[String(row.project_name)] = row.cost || 0;
    }
  }

  // Fill in missing dates with zero cost
  const result: DailyCost[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - (i * 86400000));
    const dateStrParts = date.toISOString().split('T');
    const dateStr = dateStrParts[0];

    if (!dateStr) continue; // Skip if date string is invalid

    const dailyCost = dailyCostMap.get(dateStr);
    if (dailyCost) {
      result.push(dailyCost);
    } else {
      result.push({
        date: dateStr,
        total_cost_usd: 0,
        projects: {}
      });
    }
  }

  return result;
}
