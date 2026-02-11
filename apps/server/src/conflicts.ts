/**
 * DevPulse Cross-Project File Conflict Detection
 *
 * Tracks file access across projects and detects conflicts when multiple
 * agents reference the same files.
 */

import { Database } from 'bun:sqlite';
import type { FileConflict } from './types';

let db: Database;

export function initConflicts(database: Database): void {
  db = database;

  // Create file_access_log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      access_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  // Create indexes for efficient queries
  db.exec('CREATE INDEX IF NOT EXISTS idx_file_access_path ON file_access_log(file_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_file_access_timestamp ON file_access_log(timestamp)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_file_access_project ON file_access_log(project_name)');

  // Create conflicts table for dismissed state tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS dismissed_conflicts (
      id TEXT PRIMARY KEY,
      dismissed_at INTEGER NOT NULL
    )
  `);

  // Clean up old file access entries (>24 hours) on init
  const oneDayAgo = Date.now() - 86400000;
  db.prepare('DELETE FROM file_access_log WHERE timestamp < ?').run(oneDayAgo);

  // Clean up old dismissed conflicts (>24 hours)
  db.prepare('DELETE FROM dismissed_conflicts WHERE dismissed_at < ?').run(oneDayAgo);
}

/**
 * Track a file access event.
 */
export function trackFileAccess(
  filePath: string,
  projectName: string,
  sessionId: string,
  sourceApp: string,
  accessType: 'read' | 'write'
): void {
  const normalized = normalizeFilePath(filePath);
  const now = Date.now();

  db.prepare(`
    INSERT INTO file_access_log (file_path, project_name, session_id, source_app, access_type, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(normalized, projectName, sessionId, sourceApp, accessType, now);
}

/**
 * Normalize file path for consistent comparison.
 * - Stores absolute paths as-is
 * - For common config files, also checks filename-only matches
 */
export function normalizeFilePath(path: string): string {
  // Remove trailing slashes
  let normalized = path.replace(/\/$/, '');

  // For common config files, extract just the filename for broader matching
  const commonConfigs = [
    'package.json',
    'tsconfig.json',
    '.env',
    '.env.local',
    'schema.prisma',
    'bun.lockb',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json'
  ];

  for (const config of commonConfigs) {
    if (normalized.endsWith(`/${config}`) || normalized === config) {
      // Return just the filename for common configs to enable cross-project matching
      return config;
    }
  }

  return normalized;
}

/**
 * Check if a file path is a package dependency file.
 */
export function isPackageFile(path: string): boolean {
  const packageFiles = [
    'package.json',
    'bun.lockb',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'Gemfile',
    'Gemfile.lock',
    'requirements.txt',
    'Pipfile',
    'Pipfile.lock',
    'go.mod',
    'go.sum',
    'Cargo.toml',
    'Cargo.lock'
  ];

  const normalized = normalizeFilePath(path);

  return packageFiles.some(pkg =>
    normalized === pkg || normalized.endsWith(`/${pkg}`)
  );
}

/**
 * Detect conflicts: multiple projects accessing the same file within the time window.
 */
export function detectConflicts(windowMinutes: number = 30): FileConflict[] {
  const windowMs = windowMinutes * 60 * 1000;
  const cutoffTime = Date.now() - windowMs;

  // Get all file accesses within the window, grouped by file_path
  const query = `
    SELECT
      file_path,
      project_name,
      session_id,
      source_app,
      access_type,
      MAX(timestamp) as last_access
    FROM file_access_log
    WHERE timestamp >= ?
    GROUP BY file_path, project_name, session_id, source_app, access_type
    ORDER BY file_path, last_access DESC
  `;

  const rows = db.prepare(query).all(cutoffTime) as Array<{
    file_path: string;
    project_name: string;
    session_id: string;
    source_app: string;
    access_type: string;
    last_access: number;
  }>;

  // Group by file_path
  const fileGroups = new Map<string, typeof rows>();

  for (const row of rows) {
    if (!fileGroups.has(row.file_path)) {
      fileGroups.set(row.file_path, []);
    }
    fileGroups.get(row.file_path)!.push(row);
  }

  const conflicts: FileConflict[] = [];

  // Check each file for cross-project access
  for (const [filePath, accesses] of fileGroups.entries()) {
    // Get unique projects accessing this file
    const projectSet = new Set(accesses.map(a => a.project_name));

    // Only flag as conflict if multiple projects are involved
    if (projectSet.size < 2) continue;

    // Determine severity
    const writeAccesses = accesses.filter(a => a.access_type === 'write');
    const writeProjects = new Set(writeAccesses.map(a => a.project_name));

    let severity: 'high' | 'medium' | 'low';

    if (writeProjects.size >= 2) {
      // Multiple projects writing to the same file
      severity = 'high';
    } else if (writeProjects.size === 1 && projectSet.size > writeProjects.size) {
      // One project writes, others read
      severity = 'medium';
    } else {
      // All read-only (informational)
      severity = 'low';
    }

    // Build project list
    const projects = accesses.map(a => ({
      project_name: a.project_name,
      agent_id: `${a.source_app}:${a.session_id.substring(0, 8)}`,
      access_type: a.access_type as 'read' | 'write',
      last_access: a.last_access
    }));

    // Create conflict ID based on file path and involved projects (for deduplication)
    const projectNames = Array.from(projectSet).sort().join(',');
    const conflictId = `${filePath}:${projectNames}`;

    // Check if this conflict has been dismissed
    const dismissed = db.prepare(
      'SELECT id FROM dismissed_conflicts WHERE id = ?'
    ).get(conflictId);

    if (dismissed) continue; // Skip dismissed conflicts

    conflicts.push({
      id: conflictId,
      file_path: filePath,
      severity,
      projects,
      detected_at: Math.min(...accesses.map(a => a.last_access)),
      dismissed: false
    });
  }

  return conflicts;
}

/**
 * Get active (non-dismissed) conflicts.
 */
export function getActiveConflicts(windowMinutes: number = 30): FileConflict[] {
  return detectConflicts(windowMinutes);
}

/**
 * Dismiss a conflict by ID.
 */
export function dismissConflict(id: string): void {
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO dismissed_conflicts (id, dismissed_at)
    VALUES (?, ?)
  `).run(id, now);
}

/**
 * Clean up old file access log entries (older than 24 hours).
 * Should be called periodically.
 */
export function cleanupOldFileAccess(): void {
  const oneDayAgo = Date.now() - 86400000;
  db.prepare('DELETE FROM file_access_log WHERE timestamp < ?').run(oneDayAgo);
  db.prepare('DELETE FROM dismissed_conflicts WHERE dismissed_at < ?').run(oneDayAgo);
}
