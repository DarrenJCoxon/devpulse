<template>
  <div
    @click="$emit('click')"
    class="inline-block cursor-pointer transition-all duration-200 hover:scale-105"
    :class="nodeOpacity"
  >
    <div
      class="px-4 py-3 rounded-lg border-2 min-w-[280px] shadow-sm hover:shadow-md transition-shadow"
      :class="[nodeBorderClass, nodeBgClass]"
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <div
            class="w-2.5 h-2.5 rounded-full"
            :class="statusDotClass"
          ></div>
          <span class="text-sm font-mono font-semibold text-[var(--theme-text-primary)]">
            {{ truncatedAgentId }}
          </span>
        </div>
        <span
          class="text-xs font-medium px-2 py-0.5 rounded-full"
          :class="statusBadgeClass"
        >
          {{ node.status }}
        </span>
      </div>

      <!-- Model -->
      <div class="text-xs text-[var(--theme-text-tertiary)] mb-1">
        <span class="font-medium">Model:</span> {{ node.model_name || 'Unknown' }}
      </div>

      <!-- Task Context -->
      <div v-if="taskSummary" class="text-xs text-[var(--theme-text-secondary)] bg-[var(--theme-bg-tertiary)] px-2 py-1 rounded mt-2 line-clamp-2">
        {{ taskSummary }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AgentNode } from '../types';

interface Props {
  node: AgentNode;
  level: number;
}

const props = defineProps<Props>();
defineEmits<{
  click: [];
}>();

const truncatedAgentId = computed(() => {
  const parts = props.node.agent_id.split(':');
  if (parts.length === 2 && parts[1]) {
    return parts[0] + ':' + parts[1].substring(0, 8);
  }
  return props.node.agent_id;
});

const taskSummary = computed(() => {
  if (!props.node.task_context) return '';
  try {
    const parsed = JSON.parse(props.node.task_context);
    if (parsed.summary) return parsed.summary;
    if (parsed.epic) return parsed.epic + (parsed.story ? ' - ' + parsed.story : '');
    return '';
  } catch {
    return props.node.task_context.substring(0, 60);
  }
});

const statusDotClass = computed(() => {
  switch (props.node.status) {
    case 'active': return 'bg-green-500 animate-pulse';
    case 'waiting': return 'bg-yellow-500';
    case 'idle': return 'bg-gray-400';
    case 'stopped': return 'bg-red-500';
    default: return 'bg-gray-400';
  }
});

const statusBadgeClass = computed(() => {
  switch (props.node.status) {
    case 'active': return 'bg-green-100 text-green-700';
    case 'waiting': return 'bg-yellow-100 text-yellow-700';
    case 'idle': return 'bg-gray-100 text-gray-600';
    case 'stopped': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-600';
  }
});

const nodeBorderClass = computed(() => {
  switch (props.node.status) {
    case 'active': return 'border-green-500';
    case 'waiting': return 'border-yellow-500';
    case 'idle': return 'border-gray-300';
    case 'stopped': return 'border-red-500';
    default: return 'border-gray-300';
  }
});

const nodeBgClass = computed(() => {
  return 'bg-[var(--theme-bg-primary)]';
});

const nodeOpacity = computed(() => {
  return props.node.status === 'stopped' ? 'opacity-50' : 'opacity-100';
});
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
