<template>
  <div v-if="activeAlerts.length > 0" class="w-full bg-[var(--theme-bg-secondary)] border-b border-[var(--theme-border-primary)]">
    <div class="max-w-full overflow-x-auto">
      <div class="flex flex-col gap-2 p-3">
        <div
          v-for="alert in activeAlerts"
          :key="alert.id"
          class="flex items-start gap-3 px-4 py-3 rounded-lg border"
          :class="alertClasses(alert.severity)"
        >
          <!-- Severity Icon -->
          <div class="flex-shrink-0 text-2xl">
            {{ severityIcon(alert.severity) }}
          </div>

          <!-- Alert Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <!-- Agent Label -->
                <div class="font-mono text-sm font-semibold mb-1">
                  {{ alert.agentLabel }}
                </div>
                <!-- Message -->
                <div class="text-sm">
                  {{ alert.message }}
                </div>
                <!-- Timestamp -->
                <div class="text-xs mt-1 opacity-75">
                  Detected {{ formatTimestamp(alert.detectedAt) }}
                </div>
              </div>

              <!-- Dismiss Button -->
              <button
                @click="dismissAlert(alert.id)"
                class="flex-shrink-0 p-1.5 rounded hover:bg-black/10 transition-colors"
                :class="dismissButtonClass(alert.severity)"
                title="Dismiss alert"
              >
                <span class="text-lg">✕</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Alert } from '../composables/useWebSocket';

const props = defineProps<{
  alerts: Alert[];
  dismissAlert: (id: string) => void;
}>();

const activeAlerts = computed(() => props.alerts);

/**
 * Get CSS classes for alert severity
 */
function alertClasses(severity: 'warning' | 'critical'): string {
  if (severity === 'critical') {
    return 'bg-[var(--theme-accent-error)]/10 border-[var(--theme-accent-error)] text-[var(--theme-text-primary)]';
  }
  return 'bg-[var(--theme-accent-warning)]/10 border-[var(--theme-accent-warning)] text-[var(--theme-text-primary)]';
}

/**
 * Get dismiss button class for severity
 */
function dismissButtonClass(severity: 'warning' | 'critical'): string {
  if (severity === 'critical') {
    return 'text-[var(--theme-accent-error)]';
  }
  return 'text-[var(--theme-accent-warning)]';
}

/**
 * Get icon for alert severity
 */
function severityIcon(severity: 'warning' | 'critical'): string {
  return severity === 'critical' ? '🚨' : '⚠️';
}

/**
 * Format timestamp as relative time
 */
function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return `${seconds}s ago`;
  }
}
</script>
