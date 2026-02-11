<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-end justify-end pointer-events-none"
  >
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/50 pointer-events-auto"
      @click="$emit('close')"
    ></div>

    <!-- Slide-out panel -->
    <div
      class="relative w-full md:w-[600px] h-full bg-[var(--theme-bg-primary)] shadow-2xl pointer-events-auto overflow-hidden flex flex-col"
    >
      <!-- Header -->
      <div class="px-6 py-4 bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-primary-light)] border-b border-[var(--theme-border-primary)]">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="w-3 h-3 rounded-full"
              :class="statusColor(agent.status)"
            ></div>
            <div>
              <h2 class="text-lg font-bold text-white">
                {{ truncatedAgentId }}
              </h2>
              <p class="text-xs text-white/80">{{ agent.model_name || 'Unknown model' }}</p>
            </div>
          </div>
          <button
            @click="$emit('close')"
            class="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
            title="Close"
          >
            <span class="text-xl text-white">✕</span>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6 space-y-6">
        <!-- Session Info -->
        <section>
          <h3 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-3 flex items-center gap-2">
            <span>📋</span>
            <span>Session Info</span>
          </h3>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-[var(--theme-text-tertiary)]">Project</span>
              <span class="font-medium text-[var(--theme-text-primary)]">{{ agent.project_name }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[var(--theme-text-tertiary)]">Status</span>
              <span
                class="px-2 py-0.5 rounded-full text-xs font-medium"
                :class="statusBadgeClass(agent.status)"
              >
                {{ agent.status }}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-[var(--theme-text-tertiary)]">Started</span>
              <span class="font-medium text-[var(--theme-text-primary)]">{{ formatTimestamp(agent.started_at) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[var(--theme-text-tertiary)]">Duration</span>
              <span class="font-medium text-[var(--theme-text-primary)]">{{ duration }}</span>
            </div>
            <div v-if="taskInfo" class="pt-2 border-t border-[var(--theme-border-secondary)]">
              <span class="text-[var(--theme-text-tertiary)]">Task</span>
              <p class="mt-1 text-xs text-[var(--theme-text-secondary)] bg-[var(--theme-bg-tertiary)] p-2 rounded">
                {{ taskInfo }}
              </p>
            </div>
          </div>
        </section>

        <!-- Recent Events -->
        <section>
          <h3 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-3 flex items-center gap-2">
            <span>📊</span>
            <span>Recent Events</span>
            <span class="text-xs text-[var(--theme-text-tertiary)] font-normal">(last 20)</span>
          </h3>

          <!-- Loading state -->
          <div v-if="loading" class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--theme-primary)]"></div>
          </div>

          <!-- Events list -->
          <div v-else-if="recentEvents.length > 0" class="space-y-2">
            <div
              v-for="event in recentEvents"
              :key="event.id"
              class="p-3 bg-[var(--theme-bg-secondary)] rounded-lg border border-[var(--theme-border-secondary)] text-xs"
            >
              <div class="flex items-center justify-between mb-1">
                <span class="font-semibold text-[var(--theme-text-primary)]">{{ event.hook_event_type }}</span>
                <span class="text-[var(--theme-text-quaternary)]">{{ formatTime(event.timestamp) }}</span>
              </div>
              <div v-if="event.summary" class="text-[var(--theme-text-tertiary)] line-clamp-2">
                {{ event.summary }}
              </div>
            </div>
          </div>

          <!-- No events -->
          <div v-else class="text-center py-8 text-[var(--theme-text-tertiary)]">
            <span class="text-2xl mb-2 block">📭</span>
            <p class="text-sm">No events found for this agent</p>
          </div>
        </section>

        <!-- Tool Breakdown -->
        <section v-if="Object.keys(toolBreakdown).length > 0">
          <h3 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-3 flex items-center gap-2">
            <span>🔧</span>
            <span>Tool Usage</span>
          </h3>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="(count, tool) in toolBreakdown"
              :key="tool"
              class="p-3 bg-[var(--theme-bg-secondary)] rounded-lg border border-[var(--theme-border-secondary)] text-center"
            >
              <div class="text-lg font-bold text-[var(--theme-text-primary)]">{{ count }}</div>
              <div class="text-xs text-[var(--theme-text-tertiary)]">{{ tool }}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { AgentNode, HookEvent, SessionStatus } from '../types';

interface Props {
  agent: AgentNode;
  isOpen: boolean;
}

const props = defineProps<Props>();
defineEmits<{
  close: [];
}>();

// State
const recentEvents = ref<HookEvent[]>([]);
const loading = ref(false);

// Computed
const truncatedAgentId = computed(() => {
  const parts = props.agent.agent_id.split(':');
  if (parts.length === 2 && parts[1]) {
    return `${parts[0]}:${parts[1].substring(0, 8)}`;
  }
  return props.agent.agent_id;
});

const taskInfo = computed(() => {
  if (!props.agent.task_context) return null;
  try {
    const parsed = JSON.parse(props.agent.task_context);
    if (parsed.summary) return parsed.summary;
    if (parsed.epic) return `${parsed.epic} - ${parsed.story || 'Task'}`;
    return null;
  } catch {
    return props.agent.task_context.substring(0, 100);
  }
});

const duration = computed(() => {
  const durationMs = props.agent.last_event_at - props.agent.started_at;
  const minutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
});

const toolBreakdown = computed(() => {
  const breakdown: Record<string, number> = {};
  for (const event of recentEvents.value) {
    if (event.hook_event_type === 'PreToolUse' || event.hook_event_type === 'PostToolUse') {
      const toolName = event.payload?.tool_name || 'Unknown';
      breakdown[toolName] = (breakdown[toolName] || 0) + 1;
    }
  }
  return breakdown;
});

// Methods
function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'active': return 'bg-green-500';
    case 'waiting': return 'bg-yellow-500';
    case 'idle': return 'bg-gray-400';
    case 'stopped': return 'bg-red-500';
    default: return 'bg-gray-400';
  }
}

function statusBadgeClass(status: SessionStatus): string {
  switch (status) {
    case 'active': return 'bg-green-100 text-green-700';
    case 'waiting': return 'bg-yellow-100 text-yellow-700';
    case 'idle': return 'bg-gray-100 text-gray-600';
    case 'stopped': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString();
}

async function fetchRecentEvents() {
  loading.value = true;
  try {
    // Extract session_id and source_app from agent_id (format: source_app:session_id)
    const parts = props.agent.agent_id.split(':');
    if (parts.length !== 2) {
      console.error('Invalid agent_id format:', props.agent.agent_id);
      return;
    }

    const [sourceApp, sessionId] = parts;

    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    const response = await fetch(`${serverUrl}/events/recent?limit=300`);

    if (!response.ok) {
      throw new Error('Failed to fetch events');
    }

    const allEvents: HookEvent[] = await response.json();

    // Filter events for this specific agent
    recentEvents.value = allEvents
      .filter(e => e.source_app === sourceApp && e.session_id === sessionId)
      .slice(-20)
      .reverse();
  } catch (error) {
    console.error('Error fetching recent events:', error);
  } finally {
    loading.value = false;
  }
}

// Watch for panel open and fetch events
watch(() => props.isOpen, (newValue) => {
  if (newValue) {
    fetchRecentEvents();
  }
});
</script>
