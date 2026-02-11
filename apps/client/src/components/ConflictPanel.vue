<template>
  <div class="fixed inset-y-0 right-0 w-96 bg-[var(--theme-bg-primary)] border-l border-[var(--theme-border-primary)] shadow-2xl z-50 flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)]">
      <h2 class="text-lg font-semibold text-[var(--theme-text-primary)]">
        File Conflicts
      </h2>
      <button
        @click="$emit('close')"
        class="p-2 rounded-lg hover:bg-[var(--theme-hover-bg)] transition-colors"
        title="Close"
      >
        <span class="text-xl">✕</span>
      </button>
    </div>

    <!-- Conflict List -->
    <div class="flex-1 overflow-y-auto p-4 space-y-3">
      <!-- Empty State -->
      <div v-if="conflicts.length === 0" class="text-center py-12">
        <div class="text-5xl mb-4">✅</div>
        <p class="text-[var(--theme-text-secondary)] text-sm">
          No file conflicts detected
        </p>
        <p class="text-[var(--theme-text-tertiary)] text-xs mt-2">
          Multiple agents can work safely across projects
        </p>
      </div>

      <!-- Conflict Cards -->
      <div
        v-for="conflict in sortedConflicts"
        :key="conflict.id"
        class="rounded-lg border p-4 space-y-3 transition-all"
        :class="{
          'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800': conflict.severity === 'high',
          'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-300 dark:border-yellow-800': conflict.severity === 'medium',
          'bg-blue-50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800': conflict.severity === 'low',
        }"
      >
        <!-- Severity Badge & File Path -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold uppercase"
                :class="{
                  'bg-red-600 text-white': conflict.severity === 'high',
                  'bg-yellow-600 text-white': conflict.severity === 'medium',
                  'bg-blue-600 text-white': conflict.severity === 'low',
                }"
              >
                <span v-if="conflict.severity === 'high'" class="animate-pulse">●</span>
                <span v-else>●</span>
                {{ conflict.severity }}
              </span>
              <span v-if="isPackageFile(conflict.file_path)" class="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded font-medium">
                📦 Package
              </span>
            </div>
            <p class="font-mono text-sm text-[var(--theme-text-primary)] break-all">
              {{ conflict.file_path }}
            </p>
          </div>
          <button
            @click="handleDismiss(conflict.id)"
            class="flex-shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            title="Dismiss conflict"
          >
            <span class="text-sm">✕</span>
          </button>
        </div>

        <!-- Involved Projects -->
        <div class="space-y-2">
          <p class="text-xs font-semibold text-[var(--theme-text-secondary)] uppercase">
            Involved Agents:
          </p>
          <div class="space-y-1.5">
            <div
              v-for="project in conflict.projects"
              :key="`${project.project_name}-${project.agent_id}`"
              class="flex items-center justify-between text-xs bg-[var(--theme-bg-primary)] rounded px-2 py-1.5"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="px-1.5 py-0.5 rounded font-semibold"
                  :class="{
                    'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300': project.access_type === 'write',
                    'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300': project.access_type === 'read',
                  }"
                >
                  {{ project.access_type === 'write' ? '✏️' : '👁️' }}
                  {{ project.access_type }}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-[var(--theme-text-primary)] truncate">
                    {{ project.project_name }}
                  </p>
                  <p class="text-[var(--theme-text-tertiary)] font-mono truncate">
                    {{ project.agent_id }}
                  </p>
                </div>
              </div>
              <span class="text-[var(--theme-text-tertiary)] whitespace-nowrap ml-2">
                {{ formatTime(project.last_access) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Detection Time -->
        <div class="text-xs text-[var(--theme-text-tertiary)] pt-2 border-t border-current/10">
          Detected {{ formatTime(conflict.detected_at) }}
        </div>
      </div>
    </div>

    <!-- Footer with Legend -->
    <div class="border-t border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)] px-4 py-3">
      <p class="text-xs font-semibold text-[var(--theme-text-secondary)] mb-2">Severity Levels:</p>
      <div class="space-y-1 text-xs text-[var(--theme-text-tertiary)]">
        <p><span class="text-red-600 font-semibold">HIGH:</span> Multiple agents writing to same file</p>
        <p><span class="text-yellow-600 font-semibold">MEDIUM:</span> One agent writing, others reading</p>
        <p><span class="text-blue-600 font-semibold">LOW:</span> Multiple agents reading (informational)</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { FileConflict } from '../types';
import { API_BASE_URL } from '../config';

interface Props {
  conflicts: FileConflict[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'dismiss', id: string): void;
}>();

// Sort conflicts by severity (high first)
const sortedConflicts = computed(() => {
  const severityOrder = { high: 0, medium: 1, low: 2 };
  return [...props.conflicts].sort((a, b) => {
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
});

// Check if file is a package file
function isPackageFile(filePath: string): boolean {
  const packageFiles = [
    'package.json',
    'bun.lockb',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'Gemfile',
    'Gemfile.lock',
    'requirements.txt',
    'Pipfile',
    'Pipfile.lock',
    'go.mod',
    'go.sum',
    'Cargo.toml',
    'Cargo.lock'
  ];

  return packageFiles.some(pkg =>
    filePath === pkg || filePath.endsWith(`/${pkg}`)
  );
}

// Format timestamp to relative time
function formatTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Handle dismiss
async function handleDismiss(id: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conflicts/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to dismiss conflict');
    }

    emit('dismiss', id);
  } catch (error) {
    console.error('Error dismissing conflict:', error);
  }
}
</script>
