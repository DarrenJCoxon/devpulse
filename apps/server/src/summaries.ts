/**
 * DevPulse Summary Aggregation
 *
 * Generates daily and weekly summaries from dev_logs table.
 * Aggregates by project with file/commit/tool breakdowns.
 */

import { Database } from 'bun:sqlite';
import type { PeriodSummary, ProjectSummary, SummaryTotals, DevLog } from './types';

let db: Database;

export function initSummaries(database: Database): void {
  db = database;
}

/**
 * Get a daily summary for a specific date.
 * @param date ISO date string (YYYY-MM-DD)
 * @returns PeriodSummary with aggregated dev logs for that day
 */
export function getDailySummary(date: string): PeriodSummary {
  // Parse the date and get start/end timestamps (UTC)
  const dateObj = new Date(date + 'T00:00:00.000Z');
  const startTimestamp = dateObj.getTime();
  const endTimestamp = startTimestamp + 86400000 - 1; // End of day (23:59:59.999)

  // Query dev_logs for the given date range
  const logs = db.prepare(
    'SELECT id, session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown FROM dev_logs WHERE ended_at >= ? AND ended_at <= ? ORDER BY ended_at ASC'
  ).all(startTimestamp, endTimestamp) as any[];

  // Parse JSON fields and convert to DevLog[]
  const devLogs: DevLog[] = logs.map(log => ({
    ...log,
    files_changed: log.files_changed || '[]',
    commits: log.commits || '[]',
    tool_breakdown: log.tool_breakdown || '{}'
  }));

  // Aggregate by project
  const projects = aggregateDevLogs(devLogs);

  // Calculate totals
  const totals = calculateTotals(projects);

  return {
    period: 'daily',
    start_date: date,
    end_date: date,
    projects,
    totals
  };
}

/**
 * Get a weekly summary for an ISO week.
 * @param isoWeek ISO week string (YYYY-Www, e.g., "2026-W07")
 * @returns PeriodSummary with aggregated dev logs for that week
 */
export function getWeeklySummary(isoWeek: string): PeriodSummary {
  // Parse ISO week string (YYYY-Www)
  const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error('Invalid ISO week format. Expected YYYY-Www (e.g., 2026-W07)');
  }

  const year = parseInt(match[1]);
  const week = parseInt(match[2]);

  // Calculate Monday and Sunday of the given ISO week
  const { monday, sunday } = getISOWeekDates(year, week);

  const startTimestamp = monday.getTime();
  const endTimestamp = sunday.getTime() + 86400000 - 1; // End of Sunday

  // Query dev_logs for the week range
  const logs = db.prepare(
    'SELECT id, session_id, project_name, branch, summary, files_changed, commits, started_at, ended_at, duration_minutes, event_count, tool_breakdown FROM dev_logs WHERE ended_at >= ? AND ended_at <= ? ORDER BY ended_at ASC'
  ).all(startTimestamp, endTimestamp) as any[];

  // Parse JSON fields and convert to DevLog[]
  const devLogs: DevLog[] = logs.map(log => ({
    ...log,
    files_changed: log.files_changed || '[]',
    commits: log.commits || '[]',
    tool_breakdown: log.tool_breakdown || '{}'
  }));

  // Aggregate by project
  const projects = aggregateDevLogs(devLogs);

  // Calculate totals
  const totals = calculateTotals(projects);

  return {
    period: 'weekly',
    start_date: formatDate(monday),
    end_date: formatDate(sunday),
    projects,
    totals
  };
}

/**
 * Aggregate dev logs by project.
 * Groups logs, merges tool breakdowns, deduplicates files and commits.
 */
export function aggregateDevLogs(logs: DevLog[]): ProjectSummary[] {
  const projectMap = new Map<string, ProjectSummary>();

  for (const log of logs) {
    const projectName = log.project_name;

    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, {
        project_name: projectName,
        session_count: 0,
        total_duration_minutes: 0,
        files_changed: [],
        commit_count: 0,
        commits: [],
        tool_breakdown: {},
        dev_logs: []
      });
    }

    const project = projectMap.get(projectName)!;

    // Increment session count
    project.session_count++;

    // Add duration
    project.total_duration_minutes += log.duration_minutes || 0;

    // Parse and merge files_changed (deduplicate)
    let filesChanged: string[] = [];
    try {
      filesChanged = JSON.parse(log.files_changed || '[]');
    } catch {}
    for (const file of filesChanged) {
      if (!project.files_changed.includes(file)) {
        project.files_changed.push(file);
      }
    }

    // Parse and merge commits (deduplicate by message)
    let commits: string[] = [];
    try {
      commits = JSON.parse(log.commits || '[]');
    } catch {}
    for (const commit of commits) {
      if (!project.commits.includes(commit)) {
        project.commits.push(commit);
        project.commit_count++;
      }
    }

    // Parse and merge tool_breakdown (sum counts)
    let toolBreakdown: Record<string, number> = {};
    try {
      toolBreakdown = JSON.parse(log.tool_breakdown || '{}');
    } catch {}
    for (const [tool, count] of Object.entries(toolBreakdown)) {
      project.tool_breakdown[tool] = (project.tool_breakdown[tool] || 0) + count;
    }

    // Add the raw dev log entry
    project.dev_logs.push(log);
  }

  return Array.from(projectMap.values());
}

/**
 * Calculate cross-project totals from aggregated project summaries.
 */
export function calculateTotals(projects: ProjectSummary[]): SummaryTotals {
  const allFiles = new Set<string>();

  let totalSessions = 0;
  let totalDurationMinutes = 0;
  let totalCommits = 0;

  for (const project of projects) {
    totalSessions += project.session_count;
    totalDurationMinutes += project.total_duration_minutes;
    totalCommits += project.commit_count;

    for (const file of project.files_changed) {
      allFiles.add(file);
    }
  }

  return {
    total_sessions: totalSessions,
    total_duration_minutes: totalDurationMinutes,
    total_files_changed: allFiles.size,
    total_commits: totalCommits,
    active_projects: projects.length
  };
}

// --- Helper functions for date arithmetic ---

/**
 * Get the Monday and Sunday of a given ISO week.
 * ISO weeks start on Monday and belong to the year containing that week's Thursday.
 */
function getISOWeekDates(year: number, week: number): { monday: Date; sunday: Date } {
  // Get January 4th of the given year (always in week 1)
  const jan4 = new Date(Date.UTC(year, 0, 4));

  // Find the Monday of week 1
  const jan4Day = jan4.getUTCDay();
  const daysToMonday = (jan4Day === 0 ? 6 : jan4Day - 1); // Sunday is 0, Monday is 1
  const week1Monday = new Date(jan4.getTime() - daysToMonday * 86400000);

  // Calculate the Monday of the target week
  const targetMonday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);

  // Calculate Sunday (6 days after Monday)
  const targetSunday = new Date(targetMonday.getTime() + 6 * 86400000);

  return {
    monday: targetMonday,
    sunday: targetSunday
  };
}

/**
 * Format a Date object as YYYY-MM-DD (UTC).
 */
function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
