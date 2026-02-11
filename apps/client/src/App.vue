<template>
  <div class="h-screen flex flex-col bg-[var(--theme-bg-secondary)]">
    <!-- Header with Primary Theme Colors -->
    <header class="short:hidden bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-primary-light)] shadow-lg border-b-2 border-[var(--theme-primary-dark)]">
      <div class="px-3 py-4 mobile:py-1.5 mobile:px-2 flex items-center justify-between mobile:gap-2">
        <!-- Title Section - Hidden on mobile -->
        <div class="mobile:hidden">
          <h1 class="text-2xl font-bold text-white drop-shadow-lg">
            DevPulse
          </h1>
        </div>

        <!-- Connection Status -->
        <div class="flex items-center mobile:space-x-1 space-x-1.5">
          <div v-if="isConnected" class="flex items-center mobile:space-x-0.5 space-x-1.5">
            <span class="relative flex mobile:h-2 mobile:w-2 h-3 w-3">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full mobile:h-2 mobile:w-2 h-3 w-3 bg-green-500"></span>
            </span>
            <span class="text-base mobile:text-xs text-white font-semibold drop-shadow-md mobile:hidden">Connected</span>
          </div>
          <div v-else class="flex items-center mobile:space-x-0.5 space-x-1.5">
            <span class="relative flex mobile:h-2 mobile:w-2 h-3 w-3">
              <span class="relative inline-flex rounded-full mobile:h-2 mobile:w-2 h-3 w-3 bg-red-500"></span>
            </span>
            <span class="text-base mobile:text-xs text-white font-semibold drop-shadow-md mobile:hidden">Disconnected</span>
          </div>
        </div>

        <!-- Controls -->
        <div class="flex items-center mobile:space-x-1 space-x-2">
          <!-- Event count (always visible) -->
          <span v-if="activeTab === 'events'" class="text-base mobile:text-xs text-white font-semibold drop-shadow-md bg-[var(--theme-primary-dark)] mobile:px-2 mobile:py-0.5 px-3 py-1.5 rounded-full border border-white/30">
            {{ events.length }}
          </span>

          <!-- Clear Button (Events tab only) -->
          <button
            v-if="activeTab === 'events'"
            @click="handleClearClick"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl"
            title="Clear events"
          >
            <span class="text-2xl mobile:text-base">🗑️</span>
          </button>

          <!-- Filters Toggle Button (Events tab only) -->
          <button
            v-if="activeTab === 'events'"
            @click="showFilters = !showFilters"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl"
            :title="showFilters ? 'Hide filters' : 'Show filters'"
          >
            <span class="text-2xl mobile:text-base">📊</span>
          </button>

          <!-- Conflicts Button (E4-S5) -->
          <button
            @click="showConflictPanel = !showConflictPanel"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl relative"
            title="File conflicts"
          >
            <span class="text-2xl mobile:text-base">⚠️</span>
            <!-- Badge for high-severity conflicts -->
            <span
              v-if="highSeverityConflictCount > 0"
              class="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center border border-white animate-pulse"
            >
              {{ highSeverityConflictCount }}
            </span>
            <!-- Badge for any conflicts -->
            <span
              v-else-if="conflicts.length > 0"
              class="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-yellow-500 text-white text-xs font-bold flex items-center justify-center border border-white"
            >
              {{ conflicts.length }}
            </span>
          </button>

          <!-- Notification Bell Button -->
          <button
            @click="showNotificationSettings = !showNotificationSettings"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl relative"
            title="Notification settings"
          >
            <span class="text-2xl mobile:text-base">🔔</span>
            <!-- Indicator dot when notifications are enabled -->
            <span
              v-if="notificationSettings.enabled"
              class="absolute top-1 right-1 h-2 w-2 rounded-full bg-green-500 border border-white"
            ></span>
          </button>

          <!-- Theme Manager Button -->
          <button
            @click="handleThemeManagerClick"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl"
            title="Open theme manager"
          >
            <span class="text-2xl mobile:text-base">🎨</span>
          </button>

          <!-- Command Palette Hint -->
          <div
            class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 border border-white/30 backdrop-blur-sm"
            title="Open command palette"
          >
            <kbd class="px-1.5 py-0.5 text-xs font-semibold text-white bg-white/20 rounded border border-white/30">⌘K</kbd>
          </div>
        </div>
      </div>
    </header>

    <!-- Tab Navigation -->
    <nav class="flex border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-primary)] px-4 overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        class="px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
        :class="activeTab === tab.id
          ? 'text-[var(--theme-primary)] border-b-2 border-[var(--theme-primary)]'
          : 'text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-secondary)]'"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- Projects Tab -->
    <div v-if="activeTab === 'projects'" class="flex-1 overflow-auto">
      <ProjectOverview :projects="projects" :sessions="sessions" />
    </div>

    <!-- Events Tab -->
    <template v-if="activeTab === 'events'">
      <!-- Filters -->
      <FilterPanel
        v-if="showFilters"
        class="short:hidden"
        :filters="filters"
        @update:filters="filters = $event"
      />

      <!-- Live Pulse Chart -->
      <LivePulseChart
        :events="events"
        :filters="filters"
        @update-unique-apps="uniqueAppNames = $event"
        @update-all-apps="allAppNames = $event"
        @update-time-range="currentTimeRange = $event"
      />

      <!-- Agent Swim Lane Container (below pulse chart, full width, hidden when empty) -->
      <div v-if="selectedAgentLanes.length > 0" class="w-full bg-[var(--theme-bg-secondary)] px-3 py-4 mobile:px-2 mobile:py-2 overflow-hidden">
        <AgentSwimLaneContainer
          :selected-agents="selectedAgentLanes"
          :events="events"
          :time-range="currentTimeRange"
          @update:selected-agents="selectedAgentLanes = $event"
        />
      </div>

      <!-- Timeline -->
      <div class="flex flex-col flex-1 overflow-hidden">
        <EventTimeline
          :events="events"
          :filters="filters"
          :unique-app-names="uniqueAppNames"
          :all-app-names="allAppNames"
          v-model:stick-to-bottom="stickToBottom"
          @select-agent="toggleAgentLane"
        />
      </div>

      <!-- Stick to bottom button -->
      <StickScrollButton
        class="short:hidden"
        :stick-to-bottom="stickToBottom"
        @toggle="stickToBottom = !stickToBottom"
      />
    </template>

    <!-- Topology Tab -->
    <div v-if="activeTab === 'topology'" class="flex-1 overflow-auto">
      <AgentTopology :topology="topology" />
    </div>

    <!-- Dev Log Tab -->
    <div v-if="activeTab === 'devlog'" class="flex-1 overflow-auto">
      <DevLogTimeline :dev-logs="devLogs" />
    </div>

    <!-- Summaries Tab -->
    <div v-if="activeTab === 'summaries'" class="flex-1 overflow-auto">
      <SummaryReport />
    </div>

    <!-- Costs Tab -->
    <div v-if="activeTab === 'costs'" class="flex-1 overflow-auto">
      <CostDashboard />
    </div>

    <!-- Metrics Tab -->
    <div v-if="activeTab === 'metrics'" class="flex-1 overflow-auto">
      <AgentMetrics />
    </div>

    <!-- Error message -->
    <div
      v-if="error"
      class="fixed bottom-4 left-4 mobile:bottom-3 mobile:left-3 mobile:right-3 bg-red-100 border border-red-400 text-red-700 px-3 py-2 mobile:px-2 mobile:py-1.5 rounded mobile:text-xs"
    >
      {{ error }}
    </div>

    <!-- Theme Manager -->
    <ThemeManager
      :is-open="showThemeManager"
      @close="showThemeManager = false"
    />

    <!-- Command Palette -->
    <CommandPalette />

    <!-- Notification Settings -->
    <NotificationSettings
      v-if="showNotificationSettings"
      :settings="notificationSettings"
      :request-permission="requestNotificationPermission"
      @close="showNotificationSettings = false"
    />

    <!-- Toast Notifications -->
    <ToastNotification
      v-for="(toast, index) in toasts"
      :key="toast.id"
      :index="index"
      :agent-name="toast.agentName"
      :agent-color="toast.agentColor"
      @dismiss="dismissToast(toast.id)"
    />

    <!-- Conflict Panel (E4-S5) -->
    <ConflictPanel
      v-if="showConflictPanel"
      :conflicts="conflicts"
      @close="showConflictPanel = false"
      @dismiss="handleConflictDismiss"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import type { TimeRange } from './types';
import { useWebSocket } from './composables/useWebSocket';
import { useProjects } from './composables/useProjects';
import { useThemes } from './composables/useThemes';
import { useEventColors } from './composables/useEventColors';
import { useNotifications } from './composables/useNotifications';
import { useCommandPalette } from './composables/useCommandPalette';
import EventTimeline from './components/EventTimeline.vue';
import FilterPanel from './components/FilterPanel.vue';
import StickScrollButton from './components/StickScrollButton.vue';
import LivePulseChart from './components/LivePulseChart.vue';
import ThemeManager from './components/ThemeManager.vue';
import CommandPalette from './components/CommandPalette.vue';
import ToastNotification from './components/ToastNotification.vue';
import AgentSwimLaneContainer from './components/AgentSwimLaneContainer.vue';
import ProjectOverview from './components/ProjectOverview.vue';
import AgentTopology from './components/AgentTopology.vue';
import DevLogTimeline from './components/DevLogTimeline.vue';
import SummaryReport from './components/SummaryReport.vue';
import NotificationSettings from './components/NotificationSettings.vue';
import CostDashboard from './components/CostDashboard.vue';
import AgentMetrics from './components/AgentMetrics.vue';
import ConflictPanel from './components/ConflictPanel.vue';
import { WS_URL } from './config';

// Tab navigation
const tabs = [
  { id: 'projects' as const, label: 'Projects' },
  { id: 'events' as const, label: 'Events' },
  { id: 'topology' as const, label: 'Topology' },
  { id: 'devlog' as const, label: 'Dev Log' },
  { id: 'summaries' as const, label: 'Summaries' },
  { id: 'costs' as const, label: 'Costs' },
  { id: 'metrics' as const, label: 'Metrics' },
];
const activeTab = ref<'projects' | 'events' | 'topology' | 'devlog' | 'summaries' | 'costs' | 'metrics'>('projects');

// WebSocket connection
const { events, isConnected, error, clearEvents, projects, sessions, topology, conflicts } = useWebSocket(WS_URL);

// Projects and dev logs
const { devLogs } = useProjects(projects, sessions);

// Theme management (sets up theme system)
useThemes();

// Event colors
const { getHexColorForApp } = useEventColors();

// Notifications
const { settings: notificationSettings, requestPermission: requestNotificationPermission } = useNotifications(events);

// Command Palette
const { registerAction, setFilterCallbacks } = useCommandPalette();

// Filters
const filters = ref({
  sourceApp: '',
  sessionId: '',
  eventType: ''
});

// UI state
const stickToBottom = ref(true);
const showThemeManager = ref(false);
const showFilters = ref(false);
const showNotificationSettings = ref(false);
const showConflictPanel = ref(false);
const uniqueAppNames = ref<string[]>([]); // Apps active in current time window
const allAppNames = ref<string[]>([]); // All apps ever seen in session
const selectedAgentLanes = ref<string[]>([]);
const currentTimeRange = ref<TimeRange>('1m'); // Current time range from LivePulseChart

// Compute high severity conflict count
const highSeverityConflictCount = computed(() => {
  return conflicts.value.filter(c => c.severity === 'high').length;
});

// Toast notifications
interface Toast {
  id: number;
  agentName: string;
  agentColor: string;
}
const toasts = ref<Toast[]>([]);
let toastIdCounter = 0;
const seenAgents = new Set<string>();

// Watch for new agents and show toast
watch(uniqueAppNames, (newAppNames) => {
  // Find agents that are new (not in seenAgents set)
  newAppNames.forEach(appName => {
    if (!seenAgents.has(appName)) {
      seenAgents.add(appName);
      // Show toast for new agent
      const toast: Toast = {
        id: toastIdCounter++,
        agentName: appName,
        agentColor: getHexColorForApp(appName)
      };
      toasts.value.push(toast);
    }
  });
}, { deep: true });

const dismissToast = (id: number) => {
  const index = toasts.value.findIndex(t => t.id === id);
  if (index !== -1) {
    toasts.value.splice(index, 1);
  }
};

// Handle agent tag clicks for swim lanes
const toggleAgentLane = (agentName: string) => {
  const index = selectedAgentLanes.value.indexOf(agentName);
  if (index >= 0) {
    // Remove from comparison
    selectedAgentLanes.value.splice(index, 1);
  } else {
    // Add to comparison
    selectedAgentLanes.value.push(agentName);
  }
};

// Handle clear button click
const handleClearClick = () => {
  clearEvents();
  selectedAgentLanes.value = [];
};

// Debug handler for theme manager
const handleThemeManagerClick = () => {
  console.log('Theme manager button clicked!');
  showThemeManager.value = true;
};

// Handle conflict dismiss
const handleConflictDismiss = (id: string) => {
  // The dismiss is handled by ConflictPanel, WebSocket will update our conflicts ref
  console.log('Conflict dismissed:', id);
};

// Register command palette actions
onMounted(() => {
  // Set up filter callbacks
  setFilterCallbacks({
    updateSessionFilter: (sessionId: string) => {
      filters.value.sessionId = sessionId;
      activeTab.value = 'events';
      showFilters.value = true;
    },
    updateSourceFilter: (sourceApp: string) => {
      filters.value.sourceApp = sourceApp;
      activeTab.value = 'events';
      showFilters.value = true;
    },
    updateTypeFilter: (eventType: string) => {
      filters.value.eventType = eventType;
      activeTab.value = 'events';
      showFilters.value = true;
    },
    navigateToProject: (_projectName: string) => {
      // Navigate to projects tab - in the future, could scroll to specific project card
      activeTab.value = 'projects';
    }
  });

  // Action: Clear events
  registerAction({
    id: 'clear-events',
    label: 'Clear Events',
    category: 'action',
    keywords: ['clear', 'events', 'reset', 'delete'],
    icon: '🗑️',
    execute: handleClearClick
  });

  // Action: Toggle theme manager
  registerAction({
    id: 'toggle-theme',
    label: 'Open Theme Manager',
    category: 'settings',
    keywords: ['theme', 'color', 'appearance', 'style'],
    icon: '🎨',
    execute: () => { showThemeManager.value = true; }
  });

  // Action: Toggle filters panel
  registerAction({
    id: 'toggle-filters',
    label: 'Toggle Filters Panel',
    category: 'action',
    keywords: ['filter', 'search', 'query'],
    icon: '📊',
    execute: () => { showFilters.value = !showFilters.value; }
  });

  // Action: Toggle notification settings
  registerAction({
    id: 'toggle-notifications',
    label: 'Notification Settings',
    category: 'settings',
    keywords: ['notification', 'bell', 'alerts'],
    icon: '🔔',
    execute: () => { showNotificationSettings.value = true; }
  });

  // Action: Toggle conflict panel
  registerAction({
    id: 'toggle-conflicts',
    label: 'View File Conflicts',
    category: 'action',
    keywords: ['conflict', 'file', 'warning'],
    icon: '⚠️',
    execute: () => { showConflictPanel.value = true; }
  });

  // Action: Navigate to Projects tab
  registerAction({
    id: 'nav-projects',
    label: 'Go to Projects Tab',
    category: 'navigate',
    keywords: ['projects', 'overview', 'dashboard'],
    icon: '📁',
    execute: () => { activeTab.value = 'projects'; }
  });

  // Action: Navigate to Events tab
  registerAction({
    id: 'nav-events',
    label: 'Go to Events Tab',
    category: 'navigate',
    keywords: ['events', 'timeline', 'stream'],
    icon: '📋',
    execute: () => { activeTab.value = 'events'; }
  });

  // Action: Navigate to Topology tab
  registerAction({
    id: 'nav-topology',
    label: 'Go to Topology Tab',
    category: 'navigate',
    keywords: ['topology', 'graph', 'agents'],
    icon: '🕸️',
    execute: () => { activeTab.value = 'topology'; }
  });

  // Action: Navigate to Dev Log tab
  registerAction({
    id: 'nav-devlog',
    label: 'Go to Dev Log Tab',
    category: 'navigate',
    keywords: ['devlog', 'log', 'history'],
    icon: '📝',
    execute: () => { activeTab.value = 'devlog'; }
  });

  // Action: Navigate to Summaries tab
  registerAction({
    id: 'nav-summaries',
    label: 'Go to Summaries Tab',
    category: 'navigate',
    keywords: ['summaries', 'summary', 'report'],
    icon: '📊',
    execute: () => { activeTab.value = 'summaries'; }
  });

  // Action: Navigate to Costs tab
  registerAction({
    id: 'nav-costs',
    label: 'Go to Costs Tab',
    category: 'navigate',
    keywords: ['costs', 'pricing', 'money'],
    icon: '💰',
    execute: () => { activeTab.value = 'costs'; }
  });

  // Action: Navigate to Metrics tab
  registerAction({
    id: 'nav-metrics',
    label: 'Go to Metrics Tab',
    category: 'navigate',
    keywords: ['metrics', 'performance', 'stats'],
    icon: '📈',
    execute: () => { activeTab.value = 'metrics'; }
  });
});
</script>
