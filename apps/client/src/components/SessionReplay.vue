<template>
  <div class="h-full flex flex-col bg-[var(--theme-bg-secondary)]">
    <!-- Back button and header -->
    <div class="bg-[var(--theme-bg-primary)] border-b border-[var(--theme-border-primary)] p-4">
      <button
        @click="handleBack"
        class="flex items-center gap-2 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors mb-3"
      >
        <span>←</span>
        <span>Back to Dev Logs</span>
      </button>

      <h2 class="text-xl font-bold text-[var(--theme-text-primary)] mb-2">
        Session Replay
      </h2>
      <div class="text-sm text-[var(--theme-text-tertiary)] font-mono">
        {{ sourceApp }}:{{ sessionId.slice(0, 8) }}
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--theme-primary)] mx-auto mb-3"></div>
        <p class="text-[var(--theme-text-tertiary)]">Loading session events...</p>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center text-red-500">
        <span class="text-4xl mb-3 block">❌</span>
        <p>{{ error }}</p>
      </div>
    </div>

    <!-- Content -->
    <div v-else class="flex-1 overflow-auto p-4 space-y-6">
      <!-- Stats Header -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] p-3">
          <div class="text-xs text-[var(--theme-text-tertiary)] uppercase tracking-wide mb-1">Duration</div>
          <div class="text-lg font-bold text-[var(--theme-text-primary)]">{{ stats.duration }}</div>
        </div>
        <div class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] p-3">
          <div class="text-xs text-[var(--theme-text-tertiary)] uppercase tracking-wide mb-1">Events</div>
          <div class="text-lg font-bold text-[var(--theme-text-primary)]">{{ stats.totalEvents }}</div>
        </div>
        <div class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] p-3">
          <div class="text-xs text-[var(--theme-text-tertiary)] uppercase tracking-wide mb-1">Files Read</div>
          <div class="text-lg font-bold text-blue-500">{{ stats.filesRead }}</div>
        </div>
        <div class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] p-3">
          <div class="text-xs text-[var(--theme-text-tertiary)] uppercase tracking-wide mb-1">Files Written</div>
          <div class="text-lg font-bold text-green-500">{{ stats.filesWritten }}</div>
        </div>
        <div class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] p-3">
          <div class="text-xs text-[var(--theme-text-tertiary)] uppercase tracking-wide mb-1">Files Edited</div>
          <div class="text-lg font-bold text-amber-500">{{ stats.filesEdited }}</div>
        </div>
      </div>

      <!-- Tool Breakdown Bar Chart -->
      <div v-if="stats.toolBreakdown.length > 0" class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] p-4">
        <div class="text-sm text-[var(--theme-text-tertiary)] uppercase tracking-wide mb-3">Tool Usage</div>
        <div class="space-y-2">
          <div v-for="tool in stats.toolBreakdown" :key="tool.name" class="flex items-center gap-3">
            <div class="w-24 text-sm text-[var(--theme-text-secondary)] truncate">{{ tool.name }}</div>
            <div class="flex-1 bg-[var(--theme-bg-tertiary)] rounded-full h-6 overflow-hidden">
              <div
                class="h-full transition-all duration-300 flex items-center justify-end pr-2"
                :style="{
                  width: `${(tool.count / stats.totalEvents) * 100}%`,
                  backgroundColor: getToolColor(tool.name)
                }"
              >
                <span class="text-xs font-bold text-white drop-shadow">{{ tool.count }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Event Timeline -->
      <div class="bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] p-4">
        <div class="text-sm text-[var(--theme-text-tertiary)] uppercase tracking-wide mb-4">Event Timeline</div>

        <!-- Empty state -->
        <div v-if="events.length === 0" class="text-center py-8 text-[var(--theme-text-tertiary)]">
          <p>No events found for this session</p>
        </div>

        <!-- Timeline with vertical line -->
        <div v-else class="relative border-l-2 border-[var(--theme-border-secondary)] ml-4 space-y-4">
          <div
            v-for="event in events"
            :key="event.id"
            class="relative pl-8"
          >
            <!-- Event node circle -->
            <div
              class="absolute -left-[9px] w-4 h-4 rounded-full border-2"
              :class="getEventNodeClass(event)"
            ></div>

            <!-- Event card -->
            <div
              class="rounded-lg border-l-4 cursor-pointer hover:bg-[var(--theme-bg-tertiary)] transition-colors"
              :class="[
                expandedEvents.has(event.id!) ? 'bg-[var(--theme-bg-tertiary)]' : 'bg-[var(--theme-bg-secondary)]',
                getCategoryBorderClass(event)
              ]"
              @click="toggleExpand(event.id!)"
            >
              <!-- Collapsed view -->
              <div class="p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 min-w-0">
                    <!-- Type and tool name -->
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-lg">{{ getEventIcon(event) }}</span>
                      <span class="text-sm font-semibold text-[var(--theme-text-primary)]">
                        {{ event.hook_event_type }}
                      </span>
                      <span v-if="getToolName(event)" class="text-xs font-mono bg-[var(--theme-bg-quaternary)] px-2 py-0.5 rounded text-[var(--theme-text-secondary)]">
                        {{ getToolName(event) }}
                      </span>
                    </div>

                    <!-- Summary -->
                    <div class="text-sm text-[var(--theme-text-secondary)] mb-1">
                      {{ getEventSummary(event) }}
                    </div>

                    <!-- Timestamp -->
                    <div class="text-xs text-[var(--theme-text-quaternary)]">
                      {{ formatTimestamp(event.timestamp!) }}
                    </div>
                  </div>

                  <!-- Expand indicator -->
                  <div class="text-[var(--theme-text-quaternary)]">
                    {{ expandedEvents.has(event.id!) ? '▼' : '▶' }}
                  </div>
                </div>
              </div>

              <!-- Expanded detail view -->
              <div v-if="expandedEvents.has(event.id!)" class="border-t border-[var(--theme-border-secondary)] p-3">
                <!-- Bash command special handling -->
                <div v-if="getToolName(event) === 'Bash' && event.payload?.tool_input?.command">
                  <div class="text-xs text-[var(--theme-text-tertiary)] mb-2 font-medium uppercase tracking-wide">
                    Command
                  </div>
                  <div class="bg-[var(--theme-bg-quaternary)] rounded p-3 font-mono text-xs text-[var(--theme-text-secondary)] mb-3">
                    <div v-if="bashExpanded.has(event.id!) || event.payload.tool_input.command.length <= 200">
                      {{ event.payload.tool_input.command }}
                    </div>
                    <div v-else>
                      {{ event.payload.tool_input.command.slice(0, 200) }}...
                    </div>
                    <button
                      v-if="event.payload.tool_input.command.length > 200"
                      @click.stop="toggleBashExpand(event.id!)"
                      class="mt-2 text-[var(--theme-primary)] hover:underline text-xs"
                    >
                      {{ bashExpanded.has(event.id!) ? 'Show less' : 'Show more' }}
                    </button>
                  </div>
                </div>

                <!-- Tool input -->
                <div v-if="event.payload?.tool_input">
                  <div class="text-xs text-[var(--theme-text-tertiary)] mb-2 font-medium uppercase tracking-wide">
                    Tool Input
                  </div>
                  <pre class="bg-[var(--theme-bg-quaternary)] rounded p-3 font-mono text-xs text-[var(--theme-text-secondary)] overflow-x-auto mb-3">{{ formatPayload(event.payload.tool_input) }}</pre>
                </div>

                <!-- Tool result -->
                <div v-if="event.payload?.tool_result">
                  <div class="text-xs text-[var(--theme-text-tertiary)] mb-2 font-medium uppercase tracking-wide">
                    Tool Result
                  </div>
                  <pre class="bg-[var(--theme-bg-quaternary)] rounded p-3 font-mono text-xs text-[var(--theme-text-secondary)] overflow-x-auto max-h-64 overflow-y-auto">{{ formatPayload(event.payload.tool_result) }}</pre>
                </div>

                <!-- Full payload if no tool_input/tool_result -->
                <div v-if="!event.payload?.tool_input && !event.payload?.tool_result">
                  <div class="text-xs text-[var(--theme-text-tertiary)] mb-2 font-medium uppercase tracking-wide">
                    Event Payload
                  </div>
                  <pre class="bg-[var(--theme-bg-quaternary)] rounded p-3 font-mono text-xs text-[var(--theme-text-secondary)] overflow-x-auto max-h-64 overflow-y-auto">{{ formatPayload(event.payload) }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { HookEvent } from '../types';
import { API_BASE_URL } from '../config';

const props = defineProps<{
  sessionId: string;
  sourceApp: string;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
}>();

const events = ref<HookEvent[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const expandedEvents = ref<Set<number>>(new Set());
const bashExpanded = ref<Set<number>>(new Set());

// Fetch events on mount
onMounted(async () => {
  try {
    const url = `${API_BASE_URL}/api/sessions/${encodeURIComponent(props.sessionId)}/events?source_app=${encodeURIComponent(props.sourceApp)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch session events: ${response.statusText}`);
    }

    events.value = await response.json();
  } catch (err: any) {
    error.value = err.message || 'Failed to load session events';
    console.error('Error fetching session events:', err);
  } finally {
    loading.value = false;
  }
});

// Compute session stats
const stats = computed(() => {
  const firstTimestamp = events.value[0]?.timestamp || 0;
  const lastTimestamp = events.value[events.value.length - 1]?.timestamp || 0;
  const durationMs = lastTimestamp - firstTimestamp;

  const filesRead = events.value.filter(e => getToolName(e) === 'Read').length;
  const filesWritten = events.value.filter(e => getToolName(e) === 'Write').length;
  const filesEdited = events.value.filter(e => getToolName(e) === 'Edit').length;

  // Tool breakdown
  const toolCounts: Record<string, number> = {};
  events.value.forEach(e => {
    const tool = getToolName(e);
    if (tool) {
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
    }
  });

  const toolBreakdown = Object.entries(toolCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEvents: events.value.length,
    duration: formatDuration(durationMs),
    filesRead,
    filesWritten,
    filesEdited,
    toolBreakdown
  };
});

function getToolName(event: HookEvent): string | null {
  return event.payload?.tool_name || null;
}

function getEventIcon(event: HookEvent): string {
  const tool = getToolName(event);
  if (tool === 'Read') return '📖';
  if (tool === 'Write') return '✏️';
  if (tool === 'Edit') return '🔧';
  if (tool === 'Bash') return '💻';
  if (tool === 'Glob' || tool === 'Grep') return '🔍';

  if (event.hook_event_type === 'SessionStart') return '🟢';
  if (event.hook_event_type === 'SessionEnd') return '🔴';
  if (event.hook_event_type === 'Stop') return '⏹️';

  return '⚙️';
}

function getEventSummary(event: HookEvent): string {
  const tool = getToolName(event);

  if (tool === 'Read' && event.payload?.tool_input?.file_path) {
    const path = event.payload.tool_input.file_path;
    const fileName = path.split('/').pop() || path;
    return `Read file: ${fileName}`;
  }

  if (tool === 'Write' && event.payload?.tool_input?.file_path) {
    const path = event.payload.tool_input.file_path;
    const fileName = path.split('/').pop() || path;
    return `Write file: ${fileName}`;
  }

  if (tool === 'Edit' && event.payload?.tool_input?.file_path) {
    const path = event.payload.tool_input.file_path;
    const fileName = path.split('/').pop() || path;
    return `Edit file: ${fileName}`;
  }

  if (tool === 'Bash' && event.payload?.tool_input?.command) {
    const cmd = event.payload.tool_input.command;
    return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
  }

  if (event.summary) {
    return event.summary;
  }

  return event.hook_event_type;
}

function getCategoryBorderClass(event: HookEvent): string {
  const tool = getToolName(event);

  if (tool === 'Read') return 'border-l-blue-500';
  if (tool === 'Write') return 'border-l-green-500';
  if (tool === 'Edit') return 'border-l-amber-500';
  if (tool === 'Bash') return 'border-l-purple-500';
  if (tool === 'Glob' || tool === 'Grep') return 'border-l-cyan-500';

  const type = event.hook_event_type;
  if (type === 'SessionStart' || type === 'SessionEnd' || type === 'Stop') {
    return 'border-l-gray-500 border-dashed';
  }

  return 'border-l-[var(--theme-border-primary)]';
}

function getEventNodeClass(event: HookEvent): string {
  const tool = getToolName(event);

  if (tool === 'Read') return 'bg-blue-500 border-blue-600';
  if (tool === 'Write') return 'bg-green-500 border-green-600';
  if (tool === 'Edit') return 'bg-amber-500 border-amber-600';
  if (tool === 'Bash') return 'bg-purple-500 border-purple-600';
  if (tool === 'Glob' || tool === 'Grep') return 'bg-cyan-500 border-cyan-600';

  const type = event.hook_event_type;
  if (type === 'SessionStart' || type === 'SessionEnd' || type === 'Stop') {
    return 'bg-gray-400 border-gray-500';
  }

  return 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-border-primary)]';
}

function getToolColor(toolName: string): string {
  if (toolName === 'Read') return '#3b82f6';
  if (toolName === 'Write') return '#22c55e';
  if (toolName === 'Edit') return '#f59e0b';
  if (toolName === 'Bash') return '#a855f7';
  if (toolName === 'Glob' || toolName === 'Grep') return '#06b6d4';
  return '#6b7280';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '< 1s';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function formatPayload(payload: any): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload, null, 2);
}

function toggleExpand(eventId: number): void {
  if (expandedEvents.value.has(eventId)) {
    expandedEvents.value.delete(eventId);
  } else {
    expandedEvents.value.add(eventId);
  }
}

function toggleBashExpand(eventId: number): void {
  if (bashExpanded.value.has(eventId)) {
    bashExpanded.value.delete(eventId);
  } else {
    bashExpanded.value.add(eventId);
  }
}

function handleBack(): void {
  emit('back');
}
</script>
