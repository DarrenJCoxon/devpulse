<template>
  <div class="h-full flex flex-col bg-muted">
    <!-- Controls -->
    <div class="px-4 py-3 bg-background border-b border-border">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <span class="text-lg">🌳</span>
          <h2 class="text-base font-semibold text-foreground">Agent Team Topology</h2>
        </div>

        <!-- Project filter -->
        <select
          v-model="selectedProject"
          class="px-3 py-1.5 text-sm rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All Projects</option>
          <option v-for="project in projectNames" :key="project" :value="project">
            {{ project }}
          </option>
        </select>
      </div>
    </div>

    <!-- Topology Tree -->
    <div class="flex-1 overflow-auto p-6">
      <!-- Empty state -->
      <div v-if="filteredTopology.length === 0" class="flex flex-col items-center justify-center h-full text-muted-foreground">
        <span class="text-4xl mb-3">🤖</span>
        <p class="text-lg font-medium">No agent teams detected</p>
        <p class="text-sm mt-1">Multi-agent teams will appear here when subagents are spawned</p>
      </div>

      <!-- Tree visualization -->
      <div v-else class="space-y-6">
        <div v-for="root in rootNodes" :key="root.agent_id" class="topology-tree">
          <AgentNodeCard
            :node="root"
            :level="0"
            @click="selectAgent(root)"
          />
          <div v-if="root.children.length > 0" class="ml-8 mt-4 space-y-4 border-l-2 border-border pl-4">
            <AgentNodeCard
              v-for="childId in root.children"
              :key="childId"
              :node="nodeMap.get(childId)!"
              :level="1"
              @click="selectAgent(nodeMap.get(childId)!)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Panel -->
    <AgentDetailPanel
      v-if="selectedNode"
      :agent="selectedNode"
      :is-open="isPanelOpen"
      @close="closePanel"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { AgentNode } from '../types';
import AgentDetailPanel from './AgentDetailPanel.vue';
import AgentNodeCard from './AgentNodeCard.vue';

interface Props {
  topology: AgentNode[];
}

const props = defineProps<Props>();

// State
const selectedProject = ref('');
const selectedNode = ref<AgentNode | null>(null);
const isPanelOpen = ref(false);

// Computed
const projectNames = computed(() => {
  const names = new Set<string>();
  for (const node of props.topology) {
    if (node.project_name) {
      names.add(node.project_name);
    }
  }
  return Array.from(names).sort();
});

const filteredTopology = computed(() => {
  if (!selectedProject.value) {
    return props.topology;
  }
  return props.topology.filter(node => node.project_name === selectedProject.value);
});

const nodeMap = computed(() => {
  const map = new Map<string, AgentNode>();
  for (const node of filteredTopology.value) {
    map.set(node.agent_id, node);
  }
  return map;
});

const rootNodes = computed(() => {
  return filteredTopology.value.filter(node => !node.parent_id);
});

// Methods
function selectAgent(node: AgentNode) {
  selectedNode.value = node;
  isPanelOpen.value = true;
}

function closePanel() {
  isPanelOpen.value = false;
  setTimeout(() => {
    selectedNode.value = null;
  }, 300);
}
</script>

<style scoped>
.topology-tree {
  position: relative;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
