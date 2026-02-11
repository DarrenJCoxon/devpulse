<template>
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
    <!-- No projects state -->
    <div v-if="projects.length === 0" class="col-span-full flex flex-col items-center justify-center py-16 text-[var(--theme-text-tertiary)]">
      <span class="text-4xl mb-3">📡</span>
      <p class="text-lg font-medium">No projects detected yet</p>
      <p class="text-sm mt-1">Start a Claude Code session with DevPulse hooks installed</p>
    </div>

    <!-- Project cards -->
    <div
      v-for="project in projects"
      :key="project.name"
      class="bg-[var(--theme-bg-primary)] rounded-xl border border-[var(--theme-border-primary)] shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden"
    >
      <!-- Card header -->
      <div class="px-4 py-3 border-b border-[var(--theme-border-secondary)] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-lg">📁</span>
          <h3 class="text-base font-semibold text-[var(--theme-text-primary)]">{{ project.name }}</h3>
        </div>
        <div class="flex items-center gap-2">
          <!-- Active sessions badge -->
          <span
            v-if="project.active_sessions > 0"
            class="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
            :class="project.active_sessions > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
          >
            <span class="relative flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            {{ project.active_sessions }} active
          </span>
          <span v-else class="text-xs text-[var(--theme-text-quaternary)] px-2 py-0.5 rounded-full bg-[var(--theme-bg-tertiary)]">
            idle
          </span>
        </div>
      </div>

      <!-- Card body -->
      <div class="px-4 py-3 space-y-3">
        <!-- Branch -->
        <div class="flex items-center gap-2 text-sm">
          <span class="text-[var(--theme-text-tertiary)]">🌿</span>
          <code class="text-xs font-mono bg-[var(--theme-bg-tertiary)] px-2 py-0.5 rounded text-[var(--theme-text-secondary)]">
            {{ project.current_branch || 'main' }}
          </code>
        </div>

        <!-- Test status -->
        <div class="flex items-center gap-2 text-sm">
          <span>{{ testIcon(project.test_status) }}</span>
          <span
            class="text-xs font-medium"
            :class="testClass(project.test_status)"
          >
            {{ project.test_summary || project.test_status || 'No tests run' }}
          </span>
        </div>

        <!-- Dev servers -->
        <div v-if="parsedServers(project).length > 0" class="flex items-center gap-2 text-sm">
          <span>🖥️</span>
          <div class="flex flex-wrap gap-1">
            <a
              v-for="server in parsedServers(project)"
              :key="server.port"
              :href="'http://localhost:' + server.port"
              target="_blank"
              class="text-xs font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            >
              :{{ server.port }} ({{ server.type }})
            </a>
          </div>
        </div>

        <!-- Sessions list -->
        <div v-if="projectSessions(project.name).length > 0" class="mt-2">
          <div class="text-xs text-[var(--theme-text-tertiary)] mb-1.5 font-medium uppercase tracking-wide">Sessions</div>
          <div class="space-y-1">
            <div
              v-for="session in projectSessions(project.name)"
              :key="session.session_id"
              class="flex items-center justify-between text-xs bg-[var(--theme-bg-tertiary)] rounded px-2 py-1.5"
            >
              <div class="flex items-center gap-1.5">
                <span
                  class="w-2 h-2 rounded-full"
                  :class="{
                    'bg-green-500': session.status === 'active',
                    'bg-yellow-500': session.status === 'waiting',
                    'bg-gray-400': session.status === 'idle',
                    'bg-red-400': session.status === 'stopped'
                  }"
                ></span>
                <span class="font-mono text-[var(--theme-text-secondary)]">
                  {{ session.session_id.slice(0, 8) }}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[var(--theme-text-quaternary)]">
                  {{ session.model_name ? session.model_name.split('-').slice(0, 2).join('-') : '' }}
                </span>
                <span class="text-[var(--theme-text-quaternary)]">
                  {{ timeAgo(session.last_event_at) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Last activity -->
        <div class="text-xs text-[var(--theme-text-quaternary)] pt-1 border-t border-[var(--theme-border-secondary)]">
          Last activity: {{ timeAgo(project.last_activity) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Project, Session } from '../types';

const props = defineProps<{
  projects: Project[];
  sessions: Session[];
}>();

function parsedServers(project: Project): Array<{port: number; type: string}> {
  try {
    return JSON.parse(project.dev_servers || '[]');
  } catch {
    return [];
  }
}

function projectSessions(projectName: string): Session[] {
  return props.sessions.filter(s => s.project_name === projectName);
}

function testIcon(status: string): string {
  switch (status) {
    case 'passing': return '✅';
    case 'failing': return '❌';
    default: return '⏸️';
  }
}

function testClass(status: string): string {
  switch (status) {
    case 'passing': return 'text-green-600';
    case 'failing': return 'text-red-600';
    default: return 'text-[var(--theme-text-tertiary)]';
  }
}

function timeAgo(timestamp: number): string {
  if (!timestamp) return 'never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
</script>
