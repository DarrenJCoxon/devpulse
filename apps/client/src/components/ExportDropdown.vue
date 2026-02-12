<template>
  <div class="relative">
    <!-- Export button -->
    <button
      @click="isOpen = !isOpen"
      class="px-3 py-2 rounded-lg bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-primary)]/10 transition-colors text-sm font-medium text-[var(--theme-text-primary)] flex items-center gap-2"
      :title="buttonTitle"
    >
      <span>📥</span>
      <span>Export</span>
    </button>

    <!-- Dropdown -->
    <div
      v-if="isOpen"
      class="absolute right-0 top-full mt-2 w-80 bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg shadow-xl p-3 z-50"
      @click.stop
    >
      <!-- Scope selector -->
      <div class="mb-3">
        <label class="text-xs text-[var(--theme-text-tertiary)] font-medium uppercase tracking-wide mb-2 block">
          Export Scope
        </label>
        <div class="space-y-1.5">
          <label
            v-for="option in scopeOptions"
            :key="option.value"
            class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-[var(--theme-bg-tertiary)] transition-colors"
            :class="{ 'bg-[var(--theme-bg-tertiary)]': scope === option.value }"
          >
            <input
              type="radio"
              :value="option.value"
              v-model="scope"
              class="text-[var(--theme-primary)]"
            />
            <span class="text-sm text-[var(--theme-text-primary)]">{{ option.label }}</span>
          </label>
        </div>
      </div>

      <!-- Date range inputs (shown when scope is 'range') -->
      <div v-if="scope === 'range'" class="mb-3 space-y-2">
        <div>
          <label class="text-xs text-[var(--theme-text-tertiary)] font-medium block mb-1">From</label>
          <input
            type="date"
            v-model="fromDate"
            class="w-full px-2 py-1.5 text-sm rounded border border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)]"
          />
        </div>
        <div>
          <label class="text-xs text-[var(--theme-text-tertiary)] font-medium block mb-1">To</label>
          <input
            type="date"
            v-model="toDate"
            class="w-full px-2 py-1.5 text-sm rounded border border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)]"
          />
        </div>
      </div>

      <!-- Format buttons -->
      <div class="mb-3">
        <label class="text-xs text-[var(--theme-text-tertiary)] font-medium uppercase tracking-wide mb-2 block">
          Format
        </label>
        <div class="grid grid-cols-2 gap-2">
          <button
            @click="handleExport('markdown')"
            :disabled="isExporting"
            class="px-3 py-2 rounded bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-primary)]/10 text-sm font-medium text-[var(--theme-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📝 Markdown
          </button>
          <button
            @click="handleExport('json')"
            :disabled="isExporting"
            class="px-3 py-2 rounded bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-primary)]/10 text-sm font-medium text-[var(--theme-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔧 JSON
          </button>
          <button
            @click="handleExport('html')"
            :disabled="isExporting"
            class="px-3 py-2 rounded bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-primary)]/10 text-sm font-medium text-[var(--theme-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🌐 HTML
          </button>
          <button
            @click="handleExport('copy')"
            :disabled="isExporting"
            class="px-3 py-2 rounded bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-primary)]/10 text-sm font-medium text-[var(--theme-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📋 Copy
          </button>
        </div>
      </div>

      <!-- Status message -->
      <div v-if="statusMessage" class="text-xs p-2 rounded" :class="statusClass">
        {{ statusMessage }}
      </div>
    </div>

    <!-- Click outside to close -->
    <div v-if="isOpen" @click="isOpen = false" class="fixed inset-0 z-40"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DevLog } from '../types';
import {
  generateMarkdown,
  generateJSON,
  downloadFile,
  copyToClipboard,
  generateFilename
} from '../utils/exportHelpers';

const props = defineProps<{
  devLogs: DevLog[];
  projectFilter?: string;
  sessionId?: string;
  buttonTitle?: string;
}>();

const isOpen = ref(false);
const scope = ref<'session' | 'project' | 'range' | 'all'>('all');
const fromDate = ref('');
const toDate = ref('');
const isExporting = ref(false);
const statusMessage = ref('');
const statusClass = ref('');

const scopeOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = [];

  // Session option (only if sessionId is provided)
  if (props.sessionId) {
    options.push({
      value: 'session',
      label: `This Session (${props.sessionId.slice(0, 8)})`
    });
  }

  // Project option (only if projectFilter is provided)
  if (props.projectFilter) {
    options.push({
      value: 'project',
      label: `This Project (${props.projectFilter})`
    });
  }

  // Date range option
  options.push({
    value: 'range',
    label: 'Date Range'
  });

  // All option
  options.push({
    value: 'all',
    label: 'All Logs'
  });

  return options;
});

async function handleExport(format: 'markdown' | 'json' | 'html' | 'copy'): Promise<void> {
  isExporting.value = true;
  statusMessage.value = '';

  try {
    // Fetch logs based on scope
    const logs = await fetchLogsForScope();

    if (logs.length === 0) {
      showStatus('No logs found for selected scope', 'warning');
      return;
    }

    // Generate export title
    const title = generateExportTitle();

    // Generate and download based on format
    if (format === 'markdown') {
      const markdown = generateMarkdown(logs, title);
      const filename = generateFilename('md', getScopeConfig());
      downloadFile(markdown, filename, 'text/markdown');
      showStatus('Markdown report downloaded', 'success');
    } else if (format === 'json') {
      const json = generateJSON(logs);
      const filename = generateFilename('json', getScopeConfig());
      downloadFile(json, filename, 'application/json');
      showStatus('JSON data downloaded', 'success');
    } else if (format === 'html') {
      // Call server endpoint for HTML report
      await exportHTML();
      showStatus('HTML report downloaded', 'success');
    } else if (format === 'copy') {
      const markdown = generateMarkdown(logs, title);
      const success = await copyToClipboard(markdown);
      if (success) {
        showStatus('Copied to clipboard', 'success');
      } else {
        showStatus('Failed to copy to clipboard', 'error');
      }
    }
  } catch (error) {
    console.error('Export error:', error);
    showStatus('Export failed. See console for details.', 'error');
  } finally {
    isExporting.value = false;
  }
}

async function fetchLogsForScope(): Promise<DevLog[]> {
  const baseUrl = 'http://localhost:4000/api/devlogs';
  let url = baseUrl + '?limit=1000';

  // Apply filters based on scope
  if (scope.value === 'session' && props.sessionId) {
    // Filter client-side for specific session
    const allLogs = await fetch(url).then(res => res.json());
    return allLogs.filter((log: DevLog) => log.session_id === props.sessionId);
  } else if (scope.value === 'project' && props.projectFilter) {
    url += `&project=${encodeURIComponent(props.projectFilter)}`;
  } else if (scope.value === 'range') {
    // Filter client-side by date range
    const allLogs = await fetch(url).then(res => res.json());
    return filterLogsByDateRange(allLogs);
  }
  // else 'all' - fetch everything

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.statusText}`);
  }

  return response.json();
}

function filterLogsByDateRange(logs: DevLog[]): DevLog[] {
  if (!fromDate.value && !toDate.value) return logs;

  const fromTimestamp = fromDate.value ? new Date(fromDate.value).getTime() : 0;
  const toTimestamp = toDate.value ? new Date(toDate.value + 'T23:59:59').getTime() : Date.now();

  return logs.filter(log => {
    return log.ended_at >= fromTimestamp && log.ended_at <= toTimestamp;
  });
}

async function exportHTML(): Promise<void> {
  const baseUrl = 'http://localhost:4000/api/export/report';
  const params = new URLSearchParams();

  if (scope.value === 'session' && props.sessionId) {
    params.set('sessionId', props.sessionId);
  } else if (scope.value === 'project' && props.projectFilter) {
    params.set('project', props.projectFilter);
  } else if (scope.value === 'range') {
    if (fromDate.value) {
      params.set('from', new Date(fromDate.value).getTime().toString());
    }
    if (toDate.value) {
      params.set('to', new Date(toDate.value + 'T23:59:59').getTime().toString());
    }
  }

  const response = await fetch(`${baseUrl}?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to generate HTML report: ${response.statusText}`);
  }

  const html = await response.text();
  const filename = generateFilename('html', getScopeConfig());
  downloadFile(html, filename, 'text/html');
}

function generateExportTitle(): string {
  if (scope.value === 'session' && props.sessionId) {
    return `Session ${props.sessionId.slice(0, 8)}`;
  } else if (scope.value === 'project' && props.projectFilter) {
    return props.projectFilter;
  } else if (scope.value === 'range') {
    return 'Date Range Export';
  }
  return 'All Projects';
}

function getScopeConfig(): { type: string; value?: string } {
  if (scope.value === 'session' && props.sessionId) {
    return { type: 'session', value: props.sessionId };
  } else if (scope.value === 'project' && props.projectFilter) {
    return { type: 'project', value: props.projectFilter };
  } else if (scope.value === 'range') {
    return { type: 'range' };
  }
  return { type: 'all' };
}

function showStatus(message: string, type: 'success' | 'warning' | 'error'): void {
  statusMessage.value = message;

  if (type === 'success') {
    statusClass.value = 'bg-green-50 text-green-700 border border-green-200';
  } else if (type === 'warning') {
    statusClass.value = 'bg-yellow-50 text-yellow-700 border border-yellow-200';
  } else {
    statusClass.value = 'bg-red-50 text-red-700 border border-red-200';
  }

  // Clear status after 3 seconds
  setTimeout(() => {
    statusMessage.value = '';
  }, 3000);
}
</script>
