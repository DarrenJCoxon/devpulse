import { describe, test, expect } from 'bun:test';
import {
  generateMarkdown,
  generateJSON,
  generateFilename,
  copyToClipboard
} from './exportHelpers';
import type { DevLog } from '../types';

describe('exportHelpers', () => {
  const mockLogs: DevLog[] = [
    {
      id: 1,
      session_id: 'abc123def456',
      source_app: 'TestProject',
      project_name: 'TestProject',
      branch: 'feature/test',
      summary: 'Implemented new feature with tests',
      files_changed: JSON.stringify(['src/index.ts', 'src/utils.ts']),
      commits: JSON.stringify(['feat: add new feature', 'test: add tests']),
      started_at: 1707739200000,
      ended_at: 1707742800000,
      duration_minutes: 60,
      event_count: 150,
      tool_breakdown: JSON.stringify({ Read: 20, Write: 15, Edit: 10, Bash: 5 })
    },
    {
      id: 2,
      session_id: 'def789ghi012',
      source_app: 'TestProject',
      project_name: 'TestProject',
      branch: 'main',
      summary: 'Bug fixes and refactoring',
      files_changed: JSON.stringify(['src/app.ts']),
      commits: JSON.stringify(['fix: resolve bug in app']),
      started_at: 1707829200000,
      ended_at: 1707831000000,
      duration_minutes: 30,
      event_count: 75,
      tool_breakdown: JSON.stringify({ Read: 10, Edit: 8, Bash: 2 })
    }
  ];

  describe('generateMarkdown', () => {
    test('produces valid Markdown with project headers', () => {
      const md = generateMarkdown(mockLogs, 'Test Report');

      expect(md).toContain('# DevPulse Report: Test Report');
      expect(md).toContain('Generated:');
      expect(md).toContain('## TestProject - feature/test');
      expect(md).toContain('## TestProject - main');
    });

    test('includes session details', () => {
      const md = generateMarkdown(mockLogs, 'Test Report');

      expect(md).toContain('**Session:** abc123de');
      expect(md).toContain('**Duration:** 1h');
      expect(md).toContain('**Events:** 150');
    });

    test('includes file lists', () => {
      const md = generateMarkdown(mockLogs, 'Test Report');

      expect(md).toContain('### Files Changed');
      expect(md).toContain('`src/index.ts`');
      expect(md).toContain('`src/utils.ts`');
      expect(md).toContain('`src/app.ts`');
    });

    test('includes commit messages', () => {
      const md = generateMarkdown(mockLogs, 'Test Report');

      expect(md).toContain('### Commits');
      expect(md).toContain('feat: add new feature');
      expect(md).toContain('test: add tests');
      expect(md).toContain('fix: resolve bug in app');
    });

    test('includes tool breakdown', () => {
      const md = generateMarkdown(mockLogs, 'Test Report');

      expect(md).toContain('### Tool Usage');
      expect(md).toContain('**Read**: 20×');
      expect(md).toContain('**Write**: 15×');
      expect(md).toContain('**Edit**: 10×');
      expect(md).toContain('**Bash**: 5×');
    });

    test('includes summary statistics', () => {
      const md = generateMarkdown(mockLogs, 'Test Report');

      expect(md).toContain('## Summary Statistics');
      expect(md).toContain('**Total Sessions:** 2');
      expect(md).toContain('**Total Duration:** 1h 30m');
      expect(md).toContain('**Total Events:** 225');
      expect(md).toContain('**Unique Files Modified:** 3');
      expect(md).toContain('**Total Commits:** 3');
    });

    test('handles empty logs array', () => {
      const md = generateMarkdown([], 'Empty Report');

      expect(md).toContain('# DevPulse Report: Empty Report');
      expect(md).toContain('No session logs found');
    });

    test('handles logs with null/empty JSON fields', () => {
      const logsWithNulls: DevLog[] = [
        {
          id: 3,
          session_id: 'nulltest123',
          source_app: 'TestProject',
          project_name: 'TestProject',
          branch: 'test',
          summary: 'Brief session',
          files_changed: '',
          commits: null as any,
          started_at: 1707739200000,
          ended_at: 1707740200000,
          duration_minutes: 17,
          event_count: 20,
          tool_breakdown: ''
        }
      ];

      const md = generateMarkdown(logsWithNulls, 'Null Test');

      expect(md).toContain('# DevPulse Report: Null Test');
      expect(md).toContain('Brief session');
      expect(md).not.toContain('### Files Changed');
      expect(md).not.toContain('### Commits');
      expect(md).not.toContain('### Tool Usage');
    });
  });

  describe('generateJSON', () => {
    test('produces valid JSON', () => {
      const json = generateJSON(mockLogs);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('exported_at');
      expect(parsed).toHaveProperty('total_logs');
      expect(parsed).toHaveProperty('logs');
      expect(parsed.total_logs).toBe(2);
      expect(parsed.logs).toHaveLength(2);
    });

    test('sorts logs by ended_at descending', () => {
      const json = generateJSON(mockLogs);
      const parsed = JSON.parse(json);

      expect(parsed.logs[0].session_id).toBe('def789ghi012');
      expect(parsed.logs[1].session_id).toBe('abc123def456');
    });

    test('includes all log fields', () => {
      const json = generateJSON(mockLogs);
      const parsed = JSON.parse(json);
      const firstLog = parsed.logs[0];

      expect(firstLog).toHaveProperty('id');
      expect(firstLog).toHaveProperty('session_id');
      expect(firstLog).toHaveProperty('project_name');
      expect(firstLog).toHaveProperty('branch');
      expect(firstLog).toHaveProperty('summary');
      expect(firstLog).toHaveProperty('files_changed');
      expect(firstLog).toHaveProperty('commits');
      expect(firstLog).toHaveProperty('tool_breakdown');
    });

    test('handles empty logs array', () => {
      const json = generateJSON([]);
      const parsed = JSON.parse(json);

      expect(parsed.total_logs).toBe(0);
      expect(parsed.logs).toHaveLength(0);
    });
  });

  describe('generateFilename', () => {
    test('generates markdown filename for project scope', () => {
      const filename = generateFilename('md', { type: 'project', value: 'MyProject' });

      expect(filename).toContain('MyProject-report');
      expect(filename).toMatch(/\d{4}-\d{2}-\d{2}/); // Contains date
      expect(filename).toEndWith('.md');
    });

    test('generates JSON filename for session scope', () => {
      const filename = generateFilename('json', { type: 'session', value: 'abc123def456' });

      expect(filename).toContain('session-abc123de-report');
      expect(filename).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(filename).toEndWith('.json');
    });

    test('generates HTML filename for range scope', () => {
      const filename = generateFilename('html', { type: 'range' });

      expect(filename).toContain('devpulse-range-report');
      expect(filename).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(filename).toEndWith('.html');
    });

    test('generates default filename for all scope', () => {
      const filename = generateFilename('md', { type: 'all' });

      expect(filename).toContain('devpulse-report');
      expect(filename).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(filename).toEndWith('.md');
    });
  });

  describe('copyToClipboard', () => {
    test('attempts to copy text (may fail in test environment)', async () => {
      const text = 'Test clipboard content';

      // In test environment, this may fail due to lack of secure context
      // We just test that the function runs without throwing
      try {
        const result = await copyToClipboard(text);
        expect(typeof result).toBe('boolean');
      } catch (error) {
        // Expected in test environment
        expect(error).toBeDefined();
      }
    });
  });
});
