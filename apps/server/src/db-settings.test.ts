import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, rmSync } from 'node:fs';

const TEST_DB = 'test-settings.db';

let db: Database;

// Mock implementation of settings functions for testing
function initSettingsTable(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

function getSetting(db: Database, key: string): string | null {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

function setSetting(db: Database, key: string, value: string): void {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
  `);
  const now = Date.now();
  stmt.run(key, value, now, value, now);
}

function getAllSettings(db: Database): Record<string, string> {
  const stmt = db.prepare('SELECT key, value FROM settings');
  const rows = stmt.all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

beforeEach(() => {
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB);
  }
  db = new Database(TEST_DB);
  initSettingsTable(db);
});

afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB);
  }
});

test('getSetting returns null when setting does not exist', () => {
  const value = getSetting(db, 'nonexistent.key');
  expect(value).toBeNull();
});

test('setSetting creates a new setting', () => {
  setSetting(db, 'test.key', 'test-value');
  const value = getSetting(db, 'test.key');
  expect(value).toBe('test-value');
});

test('setSetting updates an existing setting', () => {
  setSetting(db, 'test.key', 'initial-value');
  setSetting(db, 'test.key', 'updated-value');
  const value = getSetting(db, 'test.key');
  expect(value).toBe('updated-value');
});

test('getAllSettings returns all settings', () => {
  setSetting(db, 'key1', 'value1');
  setSetting(db, 'key2', 'value2');
  setSetting(db, 'key3', 'value3');

  const settings = getAllSettings(db);
  expect(Object.keys(settings)).toHaveLength(3);
  expect(settings['key1']).toBe('value1');
  expect(settings['key2']).toBe('value2');
  expect(settings['key3']).toBe('value3');
});

test('getAllSettings returns empty object when no settings', () => {
  const settings = getAllSettings(db);
  expect(Object.keys(settings)).toHaveLength(0);
});

test('setSetting updates timestamp on each update', async () => {
  const stmt = db.prepare('SELECT updated_at FROM settings WHERE key = ?');

  setSetting(db, 'test.key', 'value1');
  const row1 = stmt.get('test.key') as { updated_at: number };
  const timestamp1 = row1.updated_at;

  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 10));

  setSetting(db, 'test.key', 'value2');
  const row2 = stmt.get('test.key') as { updated_at: number };
  const timestamp2 = row2.updated_at;

  expect(timestamp2).toBeGreaterThan(timestamp1);
});
