/**
 * Tests for cross-project file conflict detection
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from 'bun:sqlite';
import {
  initConflicts,
  trackFileAccess,
  detectConflicts,
  getActiveConflicts,
  dismissConflict,
  normalizeFilePath,
  isPackageFile
} from './conflicts';

// Create a fresh in-memory test database for each test
let db: Database;

beforeEach(() => {
  db = new Database(':memory:');
  initConflicts(db);
});

describe('normalizeFilePath', () => {
  test('removes trailing slashes', () => {
    expect(normalizeFilePath('/path/to/file/')).toBe('/path/to/file');
    expect(normalizeFilePath('/path/to/file')).toBe('/path/to/file');
  });

  test('extracts filename for common config files', () => {
    expect(normalizeFilePath('/project/package.json')).toBe('package.json');
    expect(normalizeFilePath('package.json')).toBe('package.json');
    expect(normalizeFilePath('/deep/path/tsconfig.json')).toBe('tsconfig.json');
    expect(normalizeFilePath('.env')).toBe('.env');
    expect(normalizeFilePath('/app/.env.local')).toBe('.env.local');
  });

  test('keeps absolute paths for non-config files', () => {
    expect(normalizeFilePath('/src/index.ts')).toBe('/src/index.ts');
    expect(normalizeFilePath('/app/components/Button.vue')).toBe('/app/components/Button.vue');
  });
});

describe('isPackageFile', () => {
  test('returns true for package.json', () => {
    expect(isPackageFile('package.json')).toBe(true);
    expect(isPackageFile('/path/to/package.json')).toBe(true);
  });

  test('returns true for lock files', () => {
    expect(isPackageFile('bun.lockb')).toBe(true);
    expect(isPackageFile('pnpm-lock.yaml')).toBe(true);
    expect(isPackageFile('yarn.lock')).toBe(true);
    expect(isPackageFile('/project/package-lock.json')).toBe(true);
  });

  test('returns true for other package managers', () => {
    expect(isPackageFile('Gemfile')).toBe(true);
    expect(isPackageFile('requirements.txt')).toBe(true);
    expect(isPackageFile('go.mod')).toBe(true);
    expect(isPackageFile('Cargo.toml')).toBe(true);
  });

  test('returns false for non-package files', () => {
    expect(isPackageFile('index.ts')).toBe(false);
    expect(isPackageFile('/src/main.js')).toBe(false);
    expect(isPackageFile('README.md')).toBe(false);
  });
});

describe('trackFileAccess', () => {
  test('inserts file access record', () => {
    trackFileAccess(
      '/src/index.ts',
      'ProjectA',
      'session123',
      'app1',
      'read'
    );

    const result = db.prepare(
      'SELECT * FROM file_access_log WHERE file_path = ?'
    ).get('/src/index.ts') as any;

    expect(result).toBeDefined();
    expect(result.project_name).toBe('ProjectA');
    expect(result.session_id).toBe('session123');
    expect(result.source_app).toBe('app1');
    expect(result.access_type).toBe('read');
  });

  test('normalizes file path before storing', () => {
    trackFileAccess(
      '/project/package.json',
      'ProjectA',
      'session123',
      'app1',
      'write'
    );

    const result = db.prepare(
      'SELECT * FROM file_access_log WHERE file_path = ?'
    ).get('package.json') as any;

    expect(result).toBeDefined();
    expect(result.file_path).toBe('package.json');
  });
});

describe('detectConflicts', () => {
  test('returns empty array when all accesses from same project', () => {
    const now = Date.now();

    trackFileAccess('/src/index.ts', 'ProjectA', 'session1', 'app1', 'read');
    trackFileAccess('/src/index.ts', 'ProjectA', 'session2', 'app1', 'write');

    const conflicts = detectConflicts(30);
    expect(conflicts).toHaveLength(0);
  });

  test('returns high severity when two projects write to same file', () => {
    trackFileAccess('package.json', 'ProjectA', 'session1', 'app1', 'write');
    trackFileAccess('package.json', 'ProjectB', 'session2', 'app2', 'write');

    const conflicts = detectConflicts(30);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('high');
    expect(conflicts[0]?.file_path).toBe('package.json');
    expect(conflicts[0]?.projects).toHaveLength(2);
  });

  test('returns medium severity when one project writes and another reads', () => {
    trackFileAccess('/src/config.ts', 'ProjectA', 'session1', 'app1', 'write');
    trackFileAccess('/src/config.ts', 'ProjectB', 'session2', 'app2', 'read');

    const conflicts = detectConflicts(30);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('medium');
    expect(conflicts[0]?.projects).toHaveLength(2);
  });

  test('returns low severity when multiple projects only read', () => {
    trackFileAccess('/shared/types.ts', 'ProjectA', 'session1', 'app1', 'read');
    trackFileAccess('/shared/types.ts', 'ProjectB', 'session2', 'app2', 'read');
    trackFileAccess('/shared/types.ts', 'ProjectC', 'session3', 'app3', 'read');

    const conflicts = detectConflicts(30);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('low');
    expect(conflicts[0]?.projects).toHaveLength(3);
  });

  test('ignores entries outside time window', () => {
    const oldTimestamp = Date.now() - (60 * 60 * 1000); // 1 hour ago

    // Insert old entry manually
    db.prepare(`
      INSERT INTO file_access_log (file_path, project_name, session_id, source_app, access_type, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('/old/file.ts', 'ProjectA', 'session1', 'app1', 'write', oldTimestamp);

    // Recent entry
    trackFileAccess('/old/file.ts', 'ProjectB', 'session2', 'app2', 'write');

    // With 30 minute window, should not detect conflict (old entry is outside)
    const conflicts = detectConflicts(30);
    expect(conflicts).toHaveLength(0);
  });

  test('truncates session_id to 8 characters in agent_id', () => {
    // Use a unique file to avoid conflicts with other tests
    trackFileAccess('/unique/test-file.ts', 'ProjectA', 'session123456789ABC', 'app1', 'write');
    trackFileAccess('/unique/test-file.ts', 'ProjectB', 'sessionABCDEFGH123', 'app2', 'write');

    const conflicts = detectConflicts(30);
    expect(conflicts).toHaveLength(1);

    const project1 = conflicts[0]?.projects.find(p => p.project_name === 'ProjectA');
    const project2 = conflicts[0]?.projects.find(p => p.project_name === 'ProjectB');

    // Session IDs should be truncated to first 8 chars in agent_id
    expect(project1?.agent_id).toBe('app1:session1');
    expect(project2?.agent_id).toBe('app2:sessionA');
  });
});

describe('getActiveConflicts and dismissConflict', () => {
  test('dismissConflict removes conflict from active list', () => {
    trackFileAccess('package.json', 'ProjectA', 'session1', 'app1', 'write');
    trackFileAccess('package.json', 'ProjectB', 'session2', 'app2', 'write');

    const conflicts = getActiveConflicts();
    expect(conflicts).toHaveLength(1);

    const conflictId = conflicts[0]?.id;
    expect(conflictId).toBeDefined();
    if (!conflictId) throw new Error('conflictId is undefined');

    dismissConflict(conflictId);

    const activeConflicts = getActiveConflicts();
    expect(activeConflicts).toHaveLength(0);
  });

  test('dismissed conflicts do not re-appear', () => {
    trackFileAccess('package.json', 'ProjectA', 'session1', 'app1', 'write');
    trackFileAccess('package.json', 'ProjectB', 'session2', 'app2', 'write');

    const conflicts = getActiveConflicts();
    const conflictId = conflicts[0]?.id;

    dismissConflict(conflictId!);

    // Add more accesses
    trackFileAccess('package.json', 'ProjectA', 'session1', 'app1', 'write');
    trackFileAccess('package.json', 'ProjectB', 'session2', 'app2', 'write');

    // Should still be dismissed
    const activeConflicts = getActiveConflicts();
    expect(activeConflicts).toHaveLength(0);
  });
});

describe('conflict deduplication', () => {
  test('generates consistent conflict ID for same file and projects', () => {
    trackFileAccess('shared.ts', 'ProjectA', 'session1', 'app1', 'write');
    trackFileAccess('shared.ts', 'ProjectB', 'session2', 'app2', 'write');

    const conflicts1 = detectConflicts(30);
    expect(conflicts1).toHaveLength(1);
    const id1 = conflicts1[0]?.id;

    // Add more accesses to same file/projects
    trackFileAccess('shared.ts', 'ProjectA', 'session1', 'app1', 'write');
    trackFileAccess('shared.ts', 'ProjectB', 'session2', 'app2', 'write');

    const conflicts2 = detectConflicts(30);
    expect(conflicts2).toHaveLength(1);
    const id2 = conflicts2[0]?.id;

    // Same conflict should have same ID
    expect(id1).toBe(id2);
  });
});
