<template>
  <div
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    @click.self="$emit('close')"
  >
    <div class="bg-[var(--theme-bg-primary)] rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden border border-[var(--theme-border-primary)]">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-[var(--theme-border-primary)]">
        <h2 class="text-xl font-bold text-[var(--theme-text-primary)]">Data Retention & Archival</h2>
        <button
          @click="$emit('close')"
          class="p-2 rounded-lg hover:bg-[var(--theme-hover-bg)] transition-colors"
          title="Close"
        >
          <span class="text-2xl">✕</span>
        </button>
      </div>

      <!-- Content -->
      <div class="overflow-y-auto max-h-[calc(90vh-5rem)] p-6">
        <!-- Stats Display -->
        <div class="mb-6">
          <h3 class="text-lg font-semibold text-[var(--theme-text-primary)] mb-4">Database Statistics</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4">
              <div class="text-sm text-[var(--theme-text-tertiary)] mb-1">Database Size</div>
              <div class="text-2xl font-bold text-[var(--theme-primary)]">{{ formatBytes(stats.dbSizeBytes) }}</div>
            </div>
            <div class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4">
              <div class="text-sm text-[var(--theme-text-tertiary)] mb-1">Total Events</div>
              <div class="text-2xl font-bold text-[var(--theme-primary)]">{{ stats.eventCount.toLocaleString() }}</div>
            </div>
            <div class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4">
              <div class="text-sm text-[var(--theme-text-tertiary)] mb-1">Dev Logs</div>
              <div class="text-2xl font-bold text-[var(--theme-primary)]">{{ stats.devLogCount.toLocaleString() }}</div>
            </div>
            <div class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4">
              <div class="text-sm text-[var(--theme-text-tertiary)] mb-1">Sessions</div>
              <div class="text-2xl font-bold text-[var(--theme-primary)]">{{ stats.sessionCount.toLocaleString() }}</div>
            </div>
            <div class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4">
              <div class="text-sm text-[var(--theme-text-tertiary)] mb-1">Oldest Event</div>
              <div class="text-sm font-semibold text-[var(--theme-text-primary)]">
                {{ stats.oldestEventTimestamp ? formatDate(stats.oldestEventTimestamp) : 'N/A' }}
              </div>
            </div>
            <div class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4">
              <div class="text-sm text-[var(--theme-text-tertiary)] mb-1">Newest Event</div>
              <div class="text-sm font-semibold text-[var(--theme-text-primary)]">
                {{ stats.newestEventTimestamp ? formatDate(stats.newestEventTimestamp) : 'N/A' }}
              </div>
            </div>
            <div class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4 col-span-2">
              <div class="text-sm text-[var(--theme-text-tertiary)] mb-1">Archive Files</div>
              <div class="text-2xl font-bold text-[var(--theme-primary)]">{{ stats.archiveCount }}</div>
            </div>
          </div>
        </div>

        <!-- Settings Form -->
        <div class="mb-6">
          <h3 class="text-lg font-semibold text-[var(--theme-text-primary)] mb-4">Retention Settings</h3>
          <div class="space-y-4">
            <!-- Event Retention -->
            <div>
              <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-2">
                Event Retention (days)
              </label>
              <input
                v-model.number="formSettings.eventsRetentionDays"
                type="number"
                min="1"
                max="365"
                class="w-full bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">Events older than this will be archived and deleted</p>
            </div>

            <!-- Dev Log Retention -->
            <div>
              <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-2">
                Dev Log Retention (days)
              </label>
              <input
                v-model.number="formSettings.devLogsRetentionDays"
                type="number"
                min="1"
                max="365"
                class="w-full bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">Dev logs older than this will be archived and deleted</p>
            </div>

            <!-- Session Retention -->
            <div>
              <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-2">
                Session Retention (days)
              </label>
              <input
                v-model.number="formSettings.sessionsRetentionDays"
                type="number"
                min="1"
                max="365"
                class="w-full bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">Stopped sessions older than this will be archived and deleted</p>
            </div>

            <!-- Archive Enabled -->
            <div>
              <label class="flex items-center space-x-3 cursor-pointer">
                <input
                  v-model="formSettings.archiveEnabled"
                  type="checkbox"
                  class="w-5 h-5 rounded border-[var(--theme-border-primary)] text-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary)]"
                />
                <span class="text-sm font-medium text-[var(--theme-text-secondary)]">Enable archival before deletion</span>
              </label>
              <p class="text-xs text-[var(--theme-text-tertiary)] mt-1 ml-8">Old data will be exported to JSON files before deletion</p>
            </div>

            <!-- Archive Directory -->
            <div>
              <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-2">
                Archive Directory
              </label>
              <input
                v-model="formSettings.archiveDirectory"
                type="text"
                class="w-full bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">Directory where archive files will be saved</p>
            </div>

            <!-- Cleanup Interval -->
            <div>
              <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-2">
                Cleanup Interval (hours)
              </label>
              <input
                v-model.number="formSettings.cleanupIntervalHours"
                type="number"
                min="1"
                max="168"
                class="w-full bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">How often to run automatic cleanup (1-168 hours)</p>
            </div>
          </div>

          <!-- Save Button -->
          <button
            @click="saveSettings"
            :disabled="isSaving"
            class="mt-4 px-4 py-2 bg-[var(--theme-primary)] text-white rounded-lg hover:bg-[var(--theme-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ isSaving ? 'Saving...' : 'Save Settings' }}
          </button>
        </div>

        <!-- Danger Zone: Manual Cleanup -->
        <div class="bg-[var(--theme-accent-error)]/10 border border-[var(--theme-accent-error)]/30 rounded-lg p-4">
          <h3 class="text-lg font-semibold text-[var(--theme-accent-error)] mb-2">Danger Zone</h3>
          <p class="text-sm text-[var(--theme-text-secondary)] mb-4">
            Run cleanup immediately to archive and delete old data based on current retention settings.
            This action cannot be undone.
          </p>
          <button
            @click="runCleanup"
            :disabled="isRunningCleanup"
            class="px-4 py-2 bg-[var(--theme-accent-error)] text-white rounded-lg hover:bg-[var(--theme-accent-error)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ isRunningCleanup ? 'Running Cleanup...' : 'Run Cleanup Now' }}
          </button>

          <!-- Cleanup Result -->
          <div v-if="cleanupResult" class="mt-4 p-4 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg">
            <h4 class="font-semibold text-[var(--theme-text-primary)] mb-2">Cleanup Complete</h4>
            <div class="text-sm text-[var(--theme-text-secondary)] space-y-1">
              <div>Events archived: <strong>{{ cleanupResult.eventsArchived }}</strong></div>
              <div>Events deleted: <strong>{{ cleanupResult.eventsDeleted }}</strong></div>
              <div>Dev logs deleted: <strong>{{ cleanupResult.devLogsDeleted }}</strong></div>
              <div>Sessions deleted: <strong>{{ cleanupResult.sessionsDeleted }}</strong></div>
              <div v-if="cleanupResult.archiveFile">Archive file: <strong class="text-xs">{{ cleanupResult.archiveFile }}</strong></div>
              <div>Database size before: <strong>{{ formatBytes(cleanupResult.dbSizeBeforeVacuum) }}</strong></div>
              <div>Database size after: <strong>{{ formatBytes(cleanupResult.dbSizeAfterVacuum) }}</strong></div>
              <div>Space reclaimed: <strong class="text-[var(--theme-accent-success)]">{{ formatBytes(cleanupResult.vacuumReclaimedBytes) }}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_URL } from '../config';

interface AdminStats {
  dbSizeBytes: number;
  eventCount: number;
  devLogCount: number;
  sessionCount: number;
  oldestEventTimestamp: number | null;
  newestEventTimestamp: number | null;
  archiveCount: number;
  archiveFiles: string[];
}

interface CleanupResult {
  eventsArchived: number;
  eventsDeleted: number;
  devLogsDeleted: number;
  sessionsDeleted: number;
  archiveFile: string | null;
  dbSizeBeforeVacuum: number;
  dbSizeAfterVacuum: number;
  vacuumReclaimedBytes: number;
}

defineEmits<{
  close: [];
}>();

const stats = ref<AdminStats>({
  dbSizeBytes: 0,
  eventCount: 0,
  devLogCount: 0,
  sessionCount: 0,
  oldestEventTimestamp: null,
  newestEventTimestamp: null,
  archiveCount: 0,
  archiveFiles: []
});

const formSettings = ref({
  eventsRetentionDays: 30,
  devLogsRetentionDays: 90,
  sessionsRetentionDays: 30,
  archiveEnabled: true,
  archiveDirectory: './archives',
  cleanupIntervalHours: 24
});

const isSaving = ref(false);
const isRunningCleanup = ref(false);
const cleanupResult = ref<CleanupResult | null>(null);

// Format bytes to human-readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Format date
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString() + ' ' + new Date(timestamp).toLocaleTimeString();
}

// Load stats
async function loadStats() {
  try {
    const response = await fetch(`${API_URL}/api/admin/stats`);
    if (response.ok) {
      stats.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load admin stats:', error);
  }
}

// Load settings
async function loadSettings() {
  try {
    const response = await fetch(`${API_URL}/api/admin/settings`);
    if (response.ok) {
      const settings = await response.json();
      formSettings.value = {
        eventsRetentionDays: parseInt(settings['retention.events.days'] || '30'),
        devLogsRetentionDays: parseInt(settings['retention.devlogs.days'] || '90'),
        sessionsRetentionDays: parseInt(settings['retention.sessions.days'] || '30'),
        archiveEnabled: settings['retention.archive.enabled'] === 'true',
        archiveDirectory: settings['retention.archive.directory'] || './archives',
        cleanupIntervalHours: parseInt(settings['retention.cleanup.interval.hours'] || '24')
      };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Save settings
async function saveSettings() {
  isSaving.value = true;
  try {
    const updates = [
      { key: 'retention.events.days', value: formSettings.value.eventsRetentionDays.toString() },
      { key: 'retention.devlogs.days', value: formSettings.value.devLogsRetentionDays.toString() },
      { key: 'retention.sessions.days', value: formSettings.value.sessionsRetentionDays.toString() },
      { key: 'retention.archive.enabled', value: formSettings.value.archiveEnabled.toString() },
      { key: 'retention.archive.directory', value: formSettings.value.archiveDirectory },
      { key: 'retention.cleanup.interval.hours', value: formSettings.value.cleanupIntervalHours.toString() }
    ];

    const response = await fetch(`${API_URL}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });

    if (response.ok) {
      alert('Settings saved successfully');
    } else {
      const error = await response.json();
      alert('Failed to save settings: ' + (error.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert('Failed to save settings: ' + error);
  } finally {
    isSaving.value = false;
  }
}

// Run cleanup
async function runCleanup() {
  if (!confirm('Are you sure you want to run cleanup now? This will archive and delete old data.')) {
    return;
  }

  isRunningCleanup.value = true;
  cleanupResult.value = null;

  try {
    const response = await fetch(`${API_URL}/api/admin/cleanup`, {
      method: 'POST'
    });

    if (response.ok) {
      cleanupResult.value = await response.json();
      // Reload stats after cleanup
      await loadStats();
    } else {
      const error = await response.json();
      alert('Cleanup failed: ' + (error.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
    alert('Cleanup failed: ' + error);
  } finally {
    isRunningCleanup.value = false;
  }
}

onMounted(() => {
  loadStats();
  loadSettings();
});
</script>
