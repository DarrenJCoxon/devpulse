import type { DevLog } from '../types';

/**
 * Generate Markdown report from dev logs
 */
export function generateMarkdown(logs: DevLog[], title: string): string {
  let md = `# DevPulse Report: ${title}\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `---\n\n`;

  if (logs.length === 0) {
    md += 'No session logs found for the selected criteria.\n';
    return md;
  }

  // Sort logs by ended_at descending (most recent first)
  const sortedLogs = [...logs].sort((a, b) => b.ended_at - a.ended_at);

  for (const log of sortedLogs) {
    md += `## ${log.project_name} - ${log.branch}\n\n`;

    // Session metadata
    md += `**Session:** ${log.session_id.slice(0, 8)} | `;
    md += `**Duration:** ${formatDuration(log.duration_minutes)} | `;
    md += `**Events:** ${log.event_count} | `;
    md += `**Completed:** ${new Date(log.ended_at).toLocaleString()}\n\n`;

    // Summary
    md += `### Summary\n\n`;
    md += `${log.summary}\n\n`;

    // Files Changed
    const files = parseJSON<string[]>(log.files_changed, []);
    if (files.length > 0) {
      md += `### Files Changed (${files.length})\n\n`;
      files.forEach((f: string) => {
        md += `- \`${f}\`\n`;
      });
      md += '\n';
    }

    // Commits
    const commits = parseJSON<string[]>(log.commits, []);
    if (commits.length > 0) {
      md += `### Commits\n\n`;
      commits.forEach((commit: string) => {
        md += `- ${commit}\n`;
      });
      md += '\n';
    }

    // Tool Breakdown
    const toolBreakdown = parseJSON<Record<string, number>>(log.tool_breakdown, {});
    const toolEntries = Object.entries(toolBreakdown);
    if (toolEntries.length > 0) {
      md += `### Tool Usage\n\n`;
      toolEntries.forEach(([tool, count]) => {
        md += `- **${tool}**: ${count}×\n`;
      });
      md += '\n';
    }

    md += `---\n\n`;
  }

  // Summary statistics
  md += `## Summary Statistics\n\n`;
  md += `- **Total Sessions:** ${logs.length}\n`;
  md += `- **Total Duration:** ${formatDuration(logs.reduce((sum, log) => sum + log.duration_minutes, 0))}\n`;
  md += `- **Total Events:** ${logs.reduce((sum, log) => sum + log.event_count, 0)}\n`;

  // Count unique files
  const allFiles = new Set<string>();
  logs.forEach(log => {
    const files = parseJSON<string[]>(log.files_changed, []);
    files.forEach(f => allFiles.add(f));
  });
  md += `- **Unique Files Modified:** ${allFiles.size}\n`;

  // Count total commits
  const totalCommits = logs.reduce((sum, log) => {
    const commits = parseJSON<string[]>(log.commits, []);
    return sum + commits.length;
  }, 0);
  md += `- **Total Commits:** ${totalCommits}\n`;

  return md;
}

/**
 * Generate JSON export from dev logs
 */
export function generateJSON(logs: DevLog[]): string {
  // Sort logs by ended_at descending
  const sortedLogs = [...logs].sort((a, b) => b.ended_at - a.ended_at);

  return JSON.stringify({
    exported_at: new Date().toISOString(),
    total_logs: sortedLogs.length,
    logs: sortedLogs
  }, null, 2);
}

/**
 * Trigger browser download of content
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard with fallback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern clipboard API first
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
    }
  }

  // Fallback for older browsers or insecure contexts
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    return successful;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
}

/**
 * Generate filename for export based on scope
 */
export function generateFilename(
  format: 'md' | 'json' | 'html',
  scope: { type: string; value?: string }
): string {
  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const extension = format === 'md' ? 'md' : format === 'json' ? 'json' : 'html';

  let baseName = 'devpulse-report';

  if (scope.type === 'project' && scope.value) {
    baseName = `${scope.value}-report`;
  } else if (scope.type === 'session' && scope.value) {
    baseName = `session-${scope.value.slice(0, 8)}-report`;
  } else if (scope.type === 'range') {
    baseName = 'devpulse-range-report';
  }

  return `${baseName}-${timestamp}.${extension}`;
}

// Helper functions

function parseJSON<T>(jsonString: string | null | undefined, defaultValue: T): T {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return defaultValue;
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
