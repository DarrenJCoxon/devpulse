import type { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface CleanupResult {
  eventsArchived: number;
  eventsDeleted: number;
  devLogsDeleted: number;
  sessionsDeleted: number;
  archiveFile: string | null;
  dbSizeBeforeVacuum: number;
  dbSizeAfterVacuum: number;
  vacuumReclaimedBytes: number;
}

/**
 * Format a timestamp range into a filename-safe date range string
 * @param cutoffTimestamp - The cutoff timestamp (anything before this is old)
 * @returns String like "2026-01-01-to-2026-01-15"
 */
function formatDateRange(cutoffTimestamp: number): string {
  const cutoffDate = new Date(cutoffTimestamp);
  const oldestPossible = new Date(0); // Unix epoch

  const formatDate = (d: Date) => {
    return d.toISOString().split('T')[0];
  };

  return `${formatDate(oldestPossible)}-to-${formatDate(cutoffDate)}`;
}

/**
 * Run cleanup: archive old data to JSON, delete expired records, and VACUUM
 */
export async function runCleanup(db: Database, settings: Record<string, string>): Promise<CleanupResult> {
  const retentionDays = parseInt(settings['retention.events.days'] || '30');
  const devLogRetentionDays = parseInt(settings['retention.devlogs.days'] || '90');
  const sessionRetentionDays = parseInt(settings['retention.sessions.days'] || '30');
  const archiveEnabled = settings['retention.archive.enabled'] === 'true';
  const archiveDir = settings['retention.archive.directory'] || './archives';

  const eventCutoff = Date.now() - (retentionDays * 86400000);
  const devLogCutoff = Date.now() - (devLogRetentionDays * 86400000);
  const sessionCutoff = Date.now() - (sessionRetentionDays * 86400000);

  let archiveFile: string | null = null;
  let eventsArchived = 0;

  // 1. Count records to archive/delete
  const eventCountStmt = db.prepare('SELECT COUNT(*) as count FROM events WHERE timestamp < ?');
  const eventCountRow = eventCountStmt.get(eventCutoff) as { count: number };
  const eventsToDelete = eventCountRow.count;

  const devLogCountStmt = db.prepare('SELECT COUNT(*) as count FROM dev_logs WHERE ended_at < ?');
  const devLogCountRow = devLogCountStmt.get(devLogCutoff) as { count: number };
  const devLogsToDelete = devLogCountRow.count;

  const sessionCountStmt = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'stopped' AND last_event_at < ?");
  const sessionCountRow = sessionCountStmt.get(sessionCutoff) as { count: number };
  const sessionsToDelete = sessionCountRow.count;

  // 2. If archive enabled, export to JSON
  if (archiveEnabled && eventsToDelete > 0) {
    // Ensure archive directory exists
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }

    // Fetch old events
    const eventsStmt = db.prepare('SELECT * FROM events WHERE timestamp < ? ORDER BY timestamp ASC');
    const events = eventsStmt.all(eventCutoff);

    // Fetch old dev logs
    const devLogsStmt = db.prepare('SELECT * FROM dev_logs WHERE ended_at < ? ORDER BY ended_at ASC');
    const devLogs = devLogsStmt.all(devLogCutoff);

    // Fetch old sessions
    const sessionsStmt = db.prepare("SELECT * FROM sessions WHERE status = 'stopped' AND last_event_at < ? ORDER BY last_event_at ASC");
    const sessions = sessionsStmt.all(sessionCutoff);

    eventsArchived = events.length;

    // Create archive file
    const dateRange = formatDateRange(eventCutoff);
    archiveFile = join(archiveDir, `devpulse-archive-${dateRange}.json`);

    const archiveData = {
      exportedAt: Date.now(),
      retentionSettings: {
        eventRetentionDays: retentionDays,
        devLogRetentionDays: devLogRetentionDays,
        sessionRetentionDays: sessionRetentionDays
      },
      cutoffs: {
        events: eventCutoff,
        devLogs: devLogCutoff,
        sessions: sessionCutoff
      },
      counts: {
        events: events.length,
        devLogs: devLogs.length,
        sessions: sessions.length
      },
      data: {
        events,
        devLogs,
        sessions
      }
    };

    await Bun.write(archiveFile, JSON.stringify(archiveData, null, 2));
  }

  // Get DB size before VACUUM
  let dbSizeBeforeVacuum = 0;
  try {
    const dbFile = Bun.file('events.db');
    dbSizeBeforeVacuum = dbFile.size || 0;
  } catch {
    dbSizeBeforeVacuum = 0;
  }

  // 3. Delete old records
  const deleteEventsStmt = db.prepare('DELETE FROM events WHERE timestamp < ?');
  deleteEventsStmt.run(eventCutoff);

  const deleteDevLogsStmt = db.prepare('DELETE FROM dev_logs WHERE ended_at < ?');
  deleteDevLogsStmt.run(devLogCutoff);

  const deleteSessionsStmt = db.prepare("DELETE FROM sessions WHERE status = 'stopped' AND last_event_at < ?");
  deleteSessionsStmt.run(sessionCutoff);

  // 4. VACUUM to reclaim disk space
  db.exec('VACUUM');

  // Get DB size after VACUUM
  let dbSizeAfterVacuum = 0;
  try {
    const dbFile = Bun.file('events.db');
    dbSizeAfterVacuum = dbFile.size || 0;
  } catch {
    dbSizeAfterVacuum = 0;
  }

  const vacuumReclaimedBytes = Math.max(0, dbSizeBeforeVacuum - dbSizeAfterVacuum);

  return {
    eventsArchived,
    eventsDeleted: eventsToDelete,
    devLogsDeleted: devLogsToDelete,
    sessionsDeleted: sessionsToDelete,
    archiveFile,
    dbSizeBeforeVacuum,
    dbSizeAfterVacuum,
    vacuumReclaimedBytes
  };
}

/**
 * Get database and archive statistics
 */
export async function getAdminStats(db: Database, settings: Record<string, string>): Promise<{
  dbSizeBytes: number;
  eventCount: number;
  devLogCount: number;
  sessionCount: number;
  oldestEventTimestamp: number | null;
  newestEventTimestamp: number | null;
  archiveCount: number;
  archiveFiles: string[];
}> {
  // Get DB file size
  let dbSizeBytes = 0;
  try {
    const dbFile = Bun.file('events.db');
    dbSizeBytes = dbFile.size || 0;
  } catch {
    dbSizeBytes = 0;
  }

  // Get event count
  const eventCountStmt = db.prepare('SELECT COUNT(*) as count FROM events');
  const eventCountRow = eventCountStmt.get() as { count: number };
  const eventCount = eventCountRow.count;

  // Get dev log count
  const devLogCountStmt = db.prepare('SELECT COUNT(*) as count FROM dev_logs');
  const devLogCountRow = devLogCountStmt.get() as { count: number };
  const devLogCount = devLogCountRow.count;

  // Get session count
  const sessionCountStmt = db.prepare('SELECT COUNT(*) as count FROM sessions');
  const sessionCountRow = sessionCountStmt.get() as { count: number };
  const sessionCount = sessionCountRow.count;

  // Get oldest and newest event timestamps
  const oldestStmt = db.prepare('SELECT MIN(timestamp) as oldest FROM events');
  const oldestRow = oldestStmt.get() as { oldest: number | null };
  const oldestEventTimestamp = oldestRow.oldest;

  const newestStmt = db.prepare('SELECT MAX(timestamp) as newest FROM events');
  const newestRow = newestStmt.get() as { newest: number | null };
  const newestEventTimestamp = newestRow.newest;

  // Get archive file count
  const archiveDir = settings['retention.archive.directory'] || './archives';
  let archiveCount = 0;
  let archiveFiles: string[] = [];

  try {
    if (existsSync(archiveDir)) {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(archiveDir);
      archiveFiles = files.filter(f => f.startsWith('devpulse-archive-') && f.endsWith('.json'));
      archiveCount = archiveFiles.length;
    }
  } catch (error) {
    console.error('[Admin Stats] Error reading archive directory:', error);
  }

  return {
    dbSizeBytes,
    eventCount,
    devLogCount,
    sessionCount,
    oldestEventTimestamp,
    newestEventTimestamp,
    archiveCount,
    archiveFiles
  };
}
