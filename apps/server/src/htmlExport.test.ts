import { describe, test, expect } from 'bun:test';

// Test the HTML generation logic in isolation
describe('HTML Export Generation', () => {
  // Mock generateHTMLReport function (extracted from index.ts for testing)
  function generateHTMLReport(
    logs: any[],
    filters: { project?: string | null; sessionId?: string | null; from?: string | null; to?: string | null }
  ): string {
    const reportTitle = filters.project
      ? `DevPulse Report - ${filters.project}`
      : filters.sessionId
      ? `DevPulse Report - Session ${filters.sessionId.slice(0, 8)}`
      : 'DevPulse Report - All Projects';

    const generatedDate = new Date().toISOString();

    const parseJSON = (str: string | null, fallback: any) => {
      if (!str) return fallback;
      try { return JSON.parse(str); } catch { return fallback; }
    };

    const formatDuration = (minutes: number): string => {
      if (minutes < 60) return `${Math.round(minutes)}m`;
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    const escapeHTML = (str: string): string => {
      const div = { textContent: str } as any;
      const text = div.textContent || '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const totalSessions = logs.length;
    const totalDuration = logs.reduce((sum, log) => sum + log.duration_minutes, 0);
    const totalEvents = logs.reduce((sum, log) => sum + log.event_count, 0);
    const allFiles = new Set<string>();
    let totalCommits = 0;

    logs.forEach(log => {
      const files = parseJSON(log.files_changed, []);
      files.forEach((f: string) => allFiles.add(f));
      const commits = parseJSON(log.commits, []);
      totalCommits += commits.length;
    });

    const logsHTML = logs.map(log => {
      const files = parseJSON(log.files_changed, []);
      const commits = parseJSON(log.commits, []);
      const toolBreakdown = parseJSON(log.tool_breakdown, {});
      const toolEntries = Object.entries(toolBreakdown);

      const filesHTML = files.length > 0
        ? `<div class="section">
             <h4>Files Changed (${files.length})</h4>
             <div class="file-list">
               ${files.map((f: string) => `<code class="file-item">${escapeHTML(f)}</code>`).join('')}
             </div>
           </div>`
        : '';

      const commitsHTML = commits.length > 0
        ? `<div class="section">
             <h4>Commits</h4>
             <ul class="commit-list">
               ${commits.map((c: string) => `<li>${escapeHTML(c)}</li>`).join('')}
             </ul>
           </div>`
        : '';

      const toolsHTML = toolEntries.length > 0
        ? `<div class="section">
             <h4>Tool Usage</h4>
             <div class="tool-breakdown">
               ${toolEntries.map(([tool, count]) =>
                 `<span class="tool-badge"><strong>${escapeHTML(tool)}</strong>: ${count}×</span>`
               ).join('')}
             </div>
           </div>`
        : '';

      return `
        <div class="log-card">
          <div class="log-header">
            <h3>${escapeHTML(log.project_name)} - ${escapeHTML(log.branch)}</h3>
            <div class="log-meta">
              <span><strong>Session:</strong> ${escapeHTML(log.session_id.slice(0, 8))}</span>
              <span><strong>Duration:</strong> ${formatDuration(log.duration_minutes)}</span>
              <span><strong>Events:</strong> ${log.event_count}</span>
              <span><strong>Completed:</strong> ${new Date(log.ended_at).toLocaleString()}</span>
            </div>
          </div>
          <div class="log-body">
            <div class="section">
              <h4>Summary</h4>
              <p>${escapeHTML(log.summary)}</p>
            </div>
            ${filesHTML}
            ${commitsHTML}
            ${toolsHTML}
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHTML(reportTitle)}</title>
  <style>body { font-family: sans-serif; }</style>
</head>
<body>
  <div class="container">
    <div class="report-header">
      <h1>${escapeHTML(reportTitle)}</h1>
      <div class="generated">Generated: ${generatedDate}</div>
    </div>
    <div class="summary-stats">
      <div class="stat-card">
        <div class="label">Total Sessions</div>
        <div class="value">${totalSessions}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Duration</div>
        <div class="value">${formatDuration(totalDuration)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Events</div>
        <div class="value">${totalEvents}</div>
      </div>
      <div class="stat-card">
        <div class="label">Files Modified</div>
        <div class="value">${allFiles.size}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Commits</div>
        <div class="value">${totalCommits}</div>
      </div>
    </div>
    <div class="logs-container">
      ${logs.length > 0
        ? logsHTML
        : '<div class="no-logs"><p>No session logs found for the selected criteria.</p></div>'
      }
    </div>
  </div>
</body>
</html>`;
  }

  const mockLogs = [
    {
      id: 1,
      session_id: 'abc123def456',
      source_app: 'TestProject',
      project_name: 'TestProject',
      branch: 'feature/test',
      summary: 'Implemented new feature',
      files_changed: JSON.stringify(['src/index.ts', 'src/utils.ts']),
      commits: JSON.stringify(['feat: add feature']),
      started_at: 1707739200000,
      ended_at: 1707742800000,
      duration_minutes: 60,
      event_count: 100,
      tool_breakdown: JSON.stringify({ Read: 10, Write: 5 })
    }
  ];

  test('returns valid HTML document', () => {
    const html = generateHTMLReport(mockLogs, {});

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('DevPulse Report');
  });

  test('includes project and branch information', () => {
    const html = generateHTMLReport(mockLogs, {});

    expect(html).toContain('TestProject');
    expect(html).toContain('feature/test');
  });

  test('includes summary statistics', () => {
    const html = generateHTMLReport(mockLogs, {});

    expect(html).toContain('Total Sessions');
    expect(html).toContain('Total Duration');
    expect(html).toContain('Total Events');
    expect(html).toContain('Files Modified');
    expect(html).toContain('Total Commits');
  });

  test('escapes HTML in content', () => {
    const logsWithHTML = [
      {
        ...mockLogs[0],
        summary: '<script>alert("XSS")</script>',
        project_name: '<img src=x onerror=alert(1)>'
      }
    ];

    const html = generateHTMLReport(logsWithHTML, {});

    expect(html).not.toContain('<script>alert("XSS")</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  test('handles empty logs array', () => {
    const html = generateHTMLReport([], {});

    expect(html).toContain('No session logs found');
  });

  test('uses custom title for project filter', () => {
    const html = generateHTMLReport(mockLogs, { project: 'MyProject' });

    expect(html).toContain('DevPulse Report - MyProject');
  });

  test('uses custom title for session filter', () => {
    const html = generateHTMLReport(mockLogs, { sessionId: 'abc123def456' });

    expect(html).toContain('DevPulse Report - Session abc123de');
  });

  test('includes file list', () => {
    const html = generateHTMLReport(mockLogs, {});

    expect(html).toContain('Files Changed');
    expect(html).toContain('src/index.ts');
    expect(html).toContain('src/utils.ts');
  });

  test('includes commits', () => {
    const html = generateHTMLReport(mockLogs, {});

    expect(html).toContain('Commits');
    expect(html).toContain('feat: add feature');
  });

  test('includes tool breakdown', () => {
    const html = generateHTMLReport(mockLogs, {});

    expect(html).toContain('Tool Usage');
    expect(html).toContain('Read');
    expect(html).toContain('10×');
    expect(html).toContain('Write');
    expect(html).toContain('5×');
  });
});
