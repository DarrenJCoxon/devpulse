<template>
  <div class="h-full overflow-y-auto bg-[var(--theme-bg-secondary)]">
    <div class="max-w-7xl mx-auto p-6">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-[var(--theme-text-primary)] mb-2">
            Webhook Manager
          </h1>
          <p class="text-[var(--theme-text-secondary)]">
            Configure webhooks to forward events to external services
          </p>
        </div>
        <button
          @click="showForm = true"
          class="px-4 py-2 bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-hover)] text-white rounded-lg transition-colors font-medium"
        >
          Add Webhook
        </button>
      </div>

      <!-- Webhooks List -->
      <div v-if="loading" class="text-center py-12 text-[var(--theme-text-tertiary)]">
        Loading webhooks...
      </div>

      <div v-else-if="webhooks.length === 0" class="text-center py-12 text-[var(--theme-text-tertiary)]">
        <p class="mb-4">No webhooks configured</p>
        <button
          @click="showForm = true"
          class="px-4 py-2 bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-hover)] text-white rounded-lg transition-colors"
        >
          Create your first webhook
        </button>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="webhook in webhooks"
          :key="webhook.id"
          class="bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg p-4"
        >
          <div class="flex items-start justify-between">
            <!-- Webhook Info -->
            <div class="flex-1">
              <div class="flex items-center space-x-3 mb-2">
                <h3 class="text-lg font-semibold text-[var(--theme-text-primary)]">
                  {{ webhook.name }}
                </h3>
                <span
                  class="px-2 py-0.5 rounded text-xs font-medium"
                  :class="webhook.active
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'"
                >
                  {{ webhook.active ? 'Active' : 'Inactive' }}
                </span>
                <span
                  v-if="webhook.last_status !== null"
                  class="px-2 py-0.5 rounded text-xs font-medium"
                  :class="getStatusClass(webhook.last_status)"
                >
                  {{ getStatusText(webhook.last_status) }}
                </span>
              </div>

              <div class="space-y-1 text-sm">
                <div class="flex items-center space-x-2">
                  <span class="text-[var(--theme-text-tertiary)]">URL:</span>
                  <code class="text-[var(--theme-text-primary)] bg-[var(--theme-bg-tertiary)] px-2 py-0.5 rounded text-xs">
                    {{ truncateUrl(webhook.url) }}
                  </code>
                </div>

                <div class="flex items-center space-x-2">
                  <span class="text-[var(--theme-text-tertiary)]">Events:</span>
                  <span class="text-[var(--theme-text-primary)]">
                    {{ getEventTypesText(webhook.event_types) }}
                  </span>
                </div>

                <div v-if="webhook.project_filter" class="flex items-center space-x-2">
                  <span class="text-[var(--theme-text-tertiary)]">Project:</span>
                  <span class="text-[var(--theme-text-primary)]">{{ webhook.project_filter }}</span>
                </div>

                <div class="flex items-center space-x-4 text-xs text-[var(--theme-text-tertiary)]">
                  <span>Triggers: {{ webhook.trigger_count }}</span>
                  <span>Failures: {{ webhook.failure_count }}</span>
                  <span v-if="webhook.last_triggered_at">
                    Last: {{ formatTimestamp(webhook.last_triggered_at) }}
                  </span>
                </div>

                <div v-if="webhook.last_error" class="text-xs text-red-400 mt-1">
                  Error: {{ webhook.last_error }}
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center space-x-2">
              <button
                @click="testWebhook(webhook)"
                :disabled="testingId === webhook.id"
                class="px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors text-sm disabled:opacity-50"
                title="Test webhook"
              >
                {{ testingId === webhook.id ? 'Testing...' : 'Test' }}
              </button>
              <button
                @click="editWebhook(webhook)"
                class="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded transition-colors text-sm"
                title="Edit webhook"
              >
                Edit
              </button>
              <button
                @click="confirmDelete(webhook)"
                class="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors text-sm"
                title="Delete webhook"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Form Modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      @click.self="closeForm"
    >
      <div class="bg-[var(--theme-bg-primary)] rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-[var(--theme-border-primary)]">
        <!-- Form Header -->
        <div class="flex items-center justify-between p-4 border-b border-[var(--theme-border-primary)]">
          <h2 class="text-xl font-bold text-[var(--theme-text-primary)]">
            {{ editingWebhook ? 'Edit Webhook' : 'Add Webhook' }}
          </h2>
          <button
            @click="closeForm"
            class="p-2 rounded-lg hover:bg-[var(--theme-hover-bg)] transition-colors"
            title="Close"
          >
            <span class="text-2xl">✕</span>
          </button>
        </div>

        <!-- Form Body -->
        <form @submit.prevent="saveWebhook" class="p-4 space-y-4">
          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-primary)] mb-1">
              Name <span class="text-red-400">*</span>
            </label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="e.g., Slack Notifications"
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-primary)] mb-1">
              URL <span class="text-red-400">*</span>
            </label>
            <input
              v-model="form.url"
              type="url"
              required
              placeholder="https://hooks.example.com/..."
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-primary)] mb-1">
              Secret (optional)
            </label>
            <input
              v-model="form.secret"
              type="password"
              placeholder="HMAC signing secret"
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
            <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">
              Used for X-DevPulse-Signature header
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-primary)] mb-1">
              Event Types
            </label>
            <div class="max-h-48 overflow-y-auto bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-3 space-y-2">
              <label class="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="form.eventTypes.length === 0"
                  @change="toggleAllEventTypes"
                  class="rounded"
                />
                <span class="text-sm text-[var(--theme-text-primary)] font-medium">All Events</span>
              </label>
              <hr class="border-[var(--theme-border-primary)]" />
              <label
                v-for="eventType in commonEventTypes"
                :key="eventType"
                class="flex items-center space-x-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  :value="eventType"
                  v-model="form.eventTypes"
                  class="rounded"
                />
                <span class="text-sm text-[var(--theme-text-primary)]">{{ eventType }}</span>
              </label>
            </div>
            <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">
              Leave empty to receive all event types
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-primary)] mb-1">
              Project Filter (optional)
            </label>
            <input
              v-model="form.projectFilter"
              type="text"
              placeholder="Leave empty for all projects"
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
          </div>

          <div class="flex items-center space-x-2">
            <input
              v-model="form.active"
              type="checkbox"
              id="active"
              class="rounded"
            />
            <label for="active" class="text-sm text-[var(--theme-text-primary)] cursor-pointer">
              Active
            </label>
          </div>

          <div class="flex items-center justify-end space-x-3 pt-4 border-t border-[var(--theme-border-primary)]">
            <button
              type="button"
              @click="closeForm"
              class="px-4 py-2 bg-[var(--theme-bg-secondary)] hover:bg-[var(--theme-hover-bg)] text-[var(--theme-text-primary)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="px-4 py-2 bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-hover)] text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {{ saving ? 'Saving...' : (editingWebhook ? 'Update' : 'Create') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="deleteConfirm"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      @click.self="deleteConfirm = null"
    >
      <div class="bg-[var(--theme-bg-primary)] rounded-lg shadow-2xl max-w-md w-full border border-[var(--theme-border-primary)]">
        <div class="p-6">
          <h3 class="text-xl font-bold text-[var(--theme-text-primary)] mb-2">
            Delete Webhook
          </h3>
          <p class="text-[var(--theme-text-secondary)] mb-4">
            Are you sure you want to delete "{{ deleteConfirm.name }}"? This action cannot be undone.
          </p>
          <div class="flex items-center justify-end space-x-3">
            <button
              @click="deleteConfirm = null"
              class="px-4 py-2 bg-[var(--theme-bg-secondary)] hover:bg-[var(--theme-hover-bg)] text-[var(--theme-text-primary)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              @click="deleteWebhook"
              class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL } from '../config';

interface Webhook {
  id: string;
  name: string;
  url: string;
  secret: string;
  event_types: string;
  project_filter: string;
  active: number;
  created_at: number;
  updated_at: number;
  last_triggered_at: number | null;
  last_status: number | null;
  last_error: string | null;
  trigger_count: number;
  failure_count: number;
}

const webhooks = ref<Webhook[]>([]);
const loading = ref(true);
const showForm = ref(false);
const editingWebhook = ref<Webhook | null>(null);
const saving = ref(false);
const testingId = ref<string | null>(null);
const deleteConfirm = ref<Webhook | null>(null);

const form = ref({
  name: '',
  url: '',
  secret: '',
  eventTypes: [] as string[],
  projectFilter: '',
  active: true
});

const commonEventTypes = [
  'SessionStart',
  'SessionStop',
  'PostToolUse',
  'PreToolUse',
  'TurnStart',
  'TurnEnd',
  'SubagentStart',
  'SubagentStop'
];

async function loadWebhooks() {
  try {
    loading.value = true;
    const response = await fetch(`${API_BASE_URL}/api/webhooks`);
    if (!response.ok) throw new Error('Failed to load webhooks');
    webhooks.value = await response.json();
  } catch (error) {
    console.error('Error loading webhooks:', error);
  } finally {
    loading.value = false;
  }
}

function editWebhook(webhook: Webhook) {
  editingWebhook.value = webhook;
  form.value = {
    name: webhook.name,
    url: webhook.url,
    secret: webhook.secret,
    eventTypes: JSON.parse(webhook.event_types || '[]'),
    projectFilter: webhook.project_filter,
    active: Boolean(webhook.active)
  };
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editingWebhook.value = null;
  form.value = {
    name: '',
    url: '',
    secret: '',
    eventTypes: [],
    projectFilter: '',
    active: true
  };
}

async function saveWebhook() {
  try {
    saving.value = true;

    const method = editingWebhook.value ? 'PUT' : 'POST';
    const url = editingWebhook.value
      ? `${API_BASE_URL}/api/webhooks/${editingWebhook.value.id}`
      : `${API_BASE_URL}/api/webhooks`;

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.value.name,
        url: form.value.url,
        secret: form.value.secret,
        eventTypes: form.value.eventTypes,
        projectFilter: form.value.projectFilter,
        active: form.value.active
      })
    });

    if (!response.ok) throw new Error('Failed to save webhook');

    await loadWebhooks();
    closeForm();
  } catch (error) {
    console.error('Error saving webhook:', error);
    alert('Failed to save webhook');
  } finally {
    saving.value = false;
  }
}

function confirmDelete(webhook: Webhook) {
  deleteConfirm.value = webhook;
}

async function deleteWebhook() {
  if (!deleteConfirm.value) return;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/webhooks/${deleteConfirm.value.id}`,
      { method: 'DELETE' }
    );

    if (!response.ok) throw new Error('Failed to delete webhook');

    await loadWebhooks();
    deleteConfirm.value = null;
  } catch (error) {
    console.error('Error deleting webhook:', error);
    alert('Failed to delete webhook');
  }
}

async function testWebhook(webhook: Webhook) {
  try {
    testingId.value = webhook.id;
    const response = await fetch(
      `${API_BASE_URL}/api/webhooks/${webhook.id}/test`,
      { method: 'POST' }
    );

    const result = await response.json();

    if (result.success) {
      alert(`Webhook test successful! Status: ${result.status}`);
    } else {
      alert(`Webhook test failed: ${result.error || 'Unknown error'}`);
    }

    await loadWebhooks();
  } catch (error) {
    console.error('Error testing webhook:', error);
    alert('Failed to test webhook');
  } finally {
    testingId.value = null;
  }
}

function toggleAllEventTypes(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  form.value.eventTypes = checked ? [] : [...commonEventTypes];
}

function truncateUrl(url: string): string {
  if (url.length <= 50) return url;
  return url.slice(0, 47) + '...';
}

function getEventTypesText(eventTypesJson: string): string {
  const types = JSON.parse(eventTypesJson || '[]');
  if (types.length === 0) return 'All events';
  if (types.length <= 2) return types.join(', ');
  return `${types.length} event types`;
}

function getStatusClass(status: number): string {
  if (status >= 200 && status < 300) {
    return 'bg-green-500/20 text-green-400';
  }
  return 'bg-red-500/20 text-red-400';
}

function getStatusText(status: number): string {
  if (status === 0) return 'Connection Failed';
  if (status >= 200 && status < 300) return `Success (${status})`;
  return `Failed (${status})`;
}

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

onMounted(() => {
  loadWebhooks();
});
</script>
