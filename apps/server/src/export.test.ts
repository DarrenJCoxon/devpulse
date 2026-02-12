import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { getDb, initDatabase } from './db';
import { initEnricher } from './enricher';

describe('Export API', () => {
  const API_URL = 'http://localhost:4000/api/export/report';

  beforeAll(() => {
    // Initialize database if not already done
    try {
      initDatabase();
      initEnricher(getDb());
    } catch {
      // Already initialized
    }

    // Insert test dev logs
    const db = getDb();

    db.run(`
      INSERT INTO dev_logs (
        session_id, source_app, project_name, branch, summary,
        files_changed, commits, started_at, ended_at, duration_minutes,
        event_count, tool_breakdown
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'test-session-001',
      'TestProjectA',
      'TestProjectA',
      'feature/export-test',
      'Test session for export functionality',
      JSON.stringify(['src/export.ts', 'src/test.ts']),
      JSON.stringify(['feat: add export API']),
      Date.now() - 3600000,
      Date.now(),
      60,
      100,
      JSON.stringify({ Read: 10, Write: 5 })
    ]);

    db.run(`
      INSERT INTO dev_logs (
        session_id, source_app, project_name, branch, summary,
        files_changed, commits, started_at, ended_at, duration_minutes,
        event_count, tool_breakdown
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'test-session-002',
      'TestProjectB',
      'TestProjectB',
      'main',
      'Another test session',
      JSON.stringify(['src/app.ts']),
      JSON.stringify([]),
      Date.now() - 7200000,
      Date.now() - 3600000,
      30,
      50,
      JSON.stringify({ Edit: 8 })
    ]);
  });

  afterAll(() => {
    // Clean up test data
    const db = getDb();
    db.run('DELETE FROM dev_logs WHERE session_id LIKE ?', ['test-session-%']);
  });

  test('returns valid HTML document', async () => {
    const response = await fetch(API_URL);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    const html = await response.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('DevPulse Report');
  });

  test('filters by project name', async () => {
    const response = await fetch(`${API_URL}?project=TestProjectA`);

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('TestProjectA');
    expect(html).toContain('Test session for export functionality');
    // Should not contain TestProjectB data
    expect(html).not.toContain('Another test session');
  });

  test('filters by session ID', async () => {
    const response = await fetch(`${API_URL}?sessionId=test-session-001`);

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('test-session-001');
    expect(html).toContain('Test session for export functionality');
    // Should not contain test-session-002
    expect(html).not.toContain('test-session-002');
  });

  test('filters by date range', async () => {
    const now = Date.now();
    const twoHoursAgo = now - 7200000;

    const response = await fetch(`${API_URL}?from=${twoHoursAgo}&to=${now}`);

    expect(response.status).toBe(200);

    const html = await response.text();
    // Should contain both sessions as they're within the range
    expect(html).toContain('TestProjectA');
    expect(html).toContain('TestProjectB');
  });

  test('includes summary statistics', async () => {
    const response = await fetch(API_URL);

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('Total Sessions');
    expect(html).toContain('Total Duration');
    expect(html).toContain('Total Events');
    expect(html).toContain('Files Modified');
    expect(html).toContain('Total Commits');
  });

  test('escapes HTML in content', async () => {
    // Insert a log with potentially dangerous HTML
    const db = getDb();
    db.run(`
      INSERT INTO dev_logs (
        session_id, source_app, project_name, branch, summary,
        files_changed, commits, started_at, ended_at, duration_minutes,
        event_count, tool_breakdown
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'test-xss-001',
      'XSSTest',
      'XSSTest',
      'test',
      '<script>alert("XSS")</script>',
      JSON.stringify(['<script>bad.js</script>']),
      JSON.stringify([]),
      Date.now() - 1000,
      Date.now(),
      1,
      5,
      JSON.stringify({})
    ]);

    const response = await fetch(`${API_URL}?sessionId=test-xss-001`);
    const html = await response.text();

    // Script tags should be escaped
    expect(html).not.toContain('<script>alert("XSS")</script>');
    expect(html).toContain('&lt;script&gt;');

    // Clean up
    db.run('DELETE FROM dev_logs WHERE session_id = ?', ['test-xss-001']);
  });

  test('handles empty result set', async () => {
    const response = await fetch(`${API_URL}?project=NonExistentProject`);

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('No session logs found');
  });

  test('includes inline CSS styling', async () => {
    const response = await fetch(API_URL);
    const html = await response.text();

    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    expect(html).toContain('font-family');
    expect(html).toContain('background');
  });

  test('is self-contained with no external dependencies', async () => {
    const response = await fetch(API_URL);
    const html = await response.text();

    // Should not have external script or stylesheet links
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=[^>]+stylesheet/);
  });
});
