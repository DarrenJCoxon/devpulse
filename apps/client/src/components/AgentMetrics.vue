<template>
  <div class="p-6 space-y-6">
    <!-- Header and Controls -->
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <h2 class="text-2xl font-bold text-[var(--theme-text-primary)]">Agent Performance Metrics</h2>

      <div class="flex items-center gap-3">
        <!-- View Toggle -->
        <div class="bg-[var(--theme-bg-tertiary)] rounded-lg p-1 flex gap-1">
          <button
            @click="viewMode = 'project'"
            class="px-4 py-2 rounded transition-colors text-sm font-medium"
            :class="viewMode === 'project'
              ? 'bg-[var(--theme-primary)] text-white'
              : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]'"
          >
            By Project
          </button>
          <button
            @click="viewMode = 'session'"
            class="px-4 py-2 rounded transition-colors text-sm font-medium"
            :class="viewMode === 'session'
              ? 'bg-[var(--theme-primary)] text-white'
              : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]'"
          >
            By Session
          </button>
        </div>

        <!-- Refresh Button -->
        <button
          @click="loadMetrics"
          :disabled="loading"
          class="px-4 py-2 bg-[var(--theme-primary)] text-white rounded-lg hover:bg-[var(--theme-primary-hover)] transition-colors disabled:opacity-50"
        >
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-col sm:flex-row gap-4">
      <!-- Project Filter (for session view) -->
      <div v-if="viewMode === 'session'" class="flex items-center gap-3">
        <label class="text-sm font-medium text-[var(--theme-text-secondary)]">Project:</label>
        <select
          v-model="selectedProject"
          class="px-3 py-2 bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
        >
          <option value="">Select a project</option>
          <option v-for="project in availableProjects" :key="project" :value="project">
            {{ project }}
          </option>
        </select>
      </div>

      <!-- Date Range Filter -->
      <div class="flex items-center gap-3">
        <label class="text-sm font-medium text-[var(--theme-text-secondary)]">From:</label>
        <input
          type="date"
          v-model="startDate"
          class="px-3 py-2 bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
        />
        <label class="text-sm font-medium text-[var(--theme-text-secondary)]">To:</label>
        <input
          type="date"
          v-model="endDate"
          class="px-3 py-2 bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
        />
        <button
          v-if="startDate || endDate"
          @click="clearDateFilter"
          class="px-3 py-2 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors"
        >
          Clear
        </button>
      </div>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
      {{ error }}
    </div>

    <!-- Project View -->
    <div v-if="viewMode === 'project' && !loading">
      <div v-if="projectMetrics.length === 0" class="text-center py-12 text-[var(--theme-text-secondary)]">
        No project metrics available
      </div>

      <div v-else class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-[var(--theme-bg-tertiary)] border-b border-[var(--theme-border-primary)]">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Project</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Sessions</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Tool Success Rate</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Avg Turn Time</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Total Events</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="project in projectMetrics"
                :key="project.project_name"
                class="border-b border-[var(--theme-border-secondary)] hover:bg-[var(--theme-hover-bg)]"
              >
                <td class="px-4 py-3 text-sm font-medium text-[var(--theme-text-primary)]">{{ project.project_name }}</td>
                <td class="px-4 py-3 text-sm text-[var(--theme-text-secondary)]">{{ project.session_count }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 max-w-[200px] h-6 bg-[var(--theme-bg-tertiary)] rounded-full overflow-hidden">
                      <div
                        class="h-full bg-green-500 transition-all"
                        :style="{ width: `${project.avg_tool_success_rate}%` }"
                      ></div>
                    </div>
                    <span class="text-sm font-medium text-[var(--theme-text-secondary)] min-w-[45px]">
                      {{ project.avg_tool_success_rate.toFixed(1) }}%
                    </span>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="text-sm font-medium"
                    :class="getTurnTimeColorClass(project.avg_turn_duration_seconds)"
                  >
                    {{ formatDuration(project.avg_turn_duration_seconds) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-sm text-[var(--theme-text-secondary)]">{{ project.total_events.toLocaleString() }}</td>
                <td class="px-4 py-3 text-sm text-[var(--theme-text-secondary)]">{{ formatMinutes(project.total_duration_minutes) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Session View -->
    <div v-if="viewMode === 'session' && !loading">
      <div v-if="!selectedProject" class="text-center py-12 text-[var(--theme-text-secondary)]">
        Select a project to view session metrics
      </div>

      <div v-else-if="sessionMetrics.length === 0" class="text-center py-12 text-[var(--theme-text-secondary)]">
        No sessions found for this project
      </div>

      <div v-else class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-[var(--theme-bg-tertiary)] border-b border-[var(--theme-border-primary)]">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Session</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Model</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Tool Success Rate</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Avg Turn Time</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Events/Min</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Duration</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-[var(--theme-text-primary)]">Activity</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="session in sessionMetrics"
                :key="`${session.source_app}:${session.session_id}`"
                class="border-b border-[var(--theme-border-secondary)] hover:bg-[var(--theme-hover-bg)]"
                :class="isOutlier(session) ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''"
              >
                <td class="px-4 py-3 text-sm font-mono text-[var(--theme-text-primary)]">
                  {{ formatSessionId(session.source_app, session.session_id) }}
                </td>
                <td class="px-4 py-3 text-sm text-[var(--theme-text-secondary)]">{{ session.model_name }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 max-w-[150px] h-6 bg-[var(--theme-bg-tertiary)] rounded-full overflow-hidden">
                      <div
                        class="h-full transition-all"
                        :class="session.tool_success_rate < 80 ? 'bg-orange-500' : 'bg-green-500'"
                        :style="{ width: `${session.tool_success_rate}%` }"
                      ></div>
                    </div>
                    <span class="text-sm font-medium text-[var(--theme-text-secondary)] min-w-[45px]">
                      {{ session.tool_success_rate.toFixed(1) }}%
                    </span>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="text-sm font-medium"
                    :class="getTurnTimeColorClass(session.avg_turn_duration_seconds)"
                  >
                    {{ formatDuration(session.avg_turn_duration_seconds) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-sm text-[var(--theme-text-secondary)]">{{ session.events_per_minute.toFixed(1) }}</td>
                <td class="px-4 py-3 text-sm text-[var(--theme-text-secondary)]">{{ formatMinutes(session.session_duration_minutes) }}</td>
                <td class="px-4 py-3">
                  <Sparkline :timeline="session.activity_timeline" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Outlier Legend -->
      <div v-if="sessionMetrics.some(isOutlier)" class="mt-4 flex items-center gap-2 text-sm text-[var(--theme-text-secondary)]">
        <div class="w-4 h-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded"></div>
        <span>Highlighted rows indicate outliers (success rate &lt; 80% or turn time &gt; 120s)</span>
      </div>
    </div>

    <!-- Loading Indicator -->
    <div v-if="loading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--theme-primary)]"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { SessionMetrics, ProjectMetrics } from '../types';
import Sparkline from './Sparkline.vue';
import { API_BASE_URL } from '../config';

// View state
const viewMode = ref<'project' | 'session'>('project');
const selectedProject = ref('');
const startDate = ref('');
const endDate = ref('');
const loading = ref(false);
const error = ref('');

// Data
const projectMetrics = ref<ProjectMetrics[]>([]);
const sessionMetrics = ref<SessionMetrics[]>([]);

// Available projects (extracted from project metrics)
const availableProjects = computed(() => {
  return projectMetrics.value.map(p => p.project_name).sort();
});

// Outlier thresholds
const LOW_SUCCESS_RATE_THRESHOLD = 80; // < 80% success rate
const HIGH_TURN_TIME_THRESHOLD = 120; // > 120 seconds

// Build query string with date filters
function buildQueryString(baseParams: Record<string, string>): string {
  const params = new URLSearchParams(baseParams);

  if (startDate.value) {
    const startTimestamp = new Date(startDate.value).getTime();
    params.append('start', startTimestamp.toString());
  }

  if (endDate.value) {
    const endTimestamp = new Date(endDate.value + 'T23:59:59').getTime();
    params.append('end', endTimestamp.toString());
  }

  return params.toString();
}

// Load metrics based on current view
async function loadMetrics() {
  loading.value = true;
  error.value = '';

  try {
    if (viewMode.value === 'project') {
      const queryString = buildQueryString({ group: 'project' });
      const response = await fetch(`${API_BASE_URL}/api/metrics?${queryString}`);
      if (!response.ok) throw new Error('Failed to load project metrics');
      projectMetrics.value = await response.json();
    } else if (viewMode.value === 'session' && selectedProject.value) {
      const queryString = buildQueryString({
        group: 'session',
        project: selectedProject.value
      });
      const response = await fetch(`${API_BASE_URL}/api/metrics?${queryString}`);
      if (!response.ok) throw new Error('Failed to load session metrics');
      sessionMetrics.value = await response.json();
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to load metrics';
    console.error('Error loading metrics:', err);
  } finally {
    loading.value = false;
  }
}

// Clear date filter
function clearDateFilter() {
  startDate.value = '';
  endDate.value = '';
}

// Load initial project metrics
loadMetrics();

// Watch for view mode changes
watch(viewMode, () => {
  if (viewMode.value === 'project') {
    loadMetrics();
  } else if (viewMode.value === 'session' && !projectMetrics.value.length) {
    // Load project metrics first to populate the project selector
    fetch(`${API_BASE_URL}/api/metrics?group=project`)
      .then(res => res.json())
      .then(data => {
        projectMetrics.value = data;
        if (data.length > 0 && !selectedProject.value) {
          selectedProject.value = data[0].project_name;
        }
      })
      .catch(console.error);
  }
});

// Watch for project selection changes
watch(selectedProject, () => {
  if (selectedProject.value) {
    loadMetrics();
  }
});

// Watch for date filter changes
watch([startDate, endDate], () => {
  loadMetrics();
});

// Format session ID as "source_app:session_id" (truncate session_id to 8 chars)
function formatSessionId(sourceApp: string, sessionId: string): string {
  return `${sourceApp}:${sessionId.slice(0, 8)}`;
}

// Format duration in seconds to human-readable string
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}m ${secs}s`;
}

// Format minutes to human-readable string
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return `${hours}h ${mins}m`;
}

// Get color class for turn time
function getTurnTimeColorClass(seconds: number): string {
  if (seconds < 30) return 'text-green-600 dark:text-green-400';
  if (seconds < 120) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

// Check if session is an outlier
function isOutlier(session: SessionMetrics): boolean {
  return session.tool_success_rate < LOW_SUCCESS_RATE_THRESHOLD || session.avg_turn_duration_seconds > HIGH_TURN_TIME_THRESHOLD;
}
</script>
