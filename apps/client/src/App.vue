<template>
  <div class="h-screen flex flex-col bg-background text-foreground">
    <!-- Simplified Header -->
    <header class="border-b border-border bg-card">
      <div class="max-w-6xl mx-auto w-full px-6 py-3 flex items-center justify-between">
      <!-- Title + Connection -->
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-bold tracking-tight">DevPulse</h1>
        <span
          class="relative flex h-2.5 w-2.5"
          :title="isConnected ? 'Connected' : 'Disconnected'"
          :aria-label="isConnected ? 'Connected to server' : 'Disconnected from server'"
          role="status"
        >
          <span
            v-if="isConnected"
            class="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-active opacity-75"
          ></span>
          <span
            class="relative inline-flex rounded-full h-2.5 w-2.5"
            :class="isConnected ? 'bg-status-active' : 'bg-destructive'"
          ></span>
        </span>
        <!-- Cmd+K hint -->
        <kbd class="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          <span class="text-xs">&#8984;</span>K
        </kbd>
      </div>

      <!-- Settings Gear -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            class="p-2 rounded-md hover:bg-accent transition-colors relative"
            title="Settings"
          >
            <Settings class="h-5 w-5 text-muted-foreground" />
            <!-- Badge dot for active alerts or conflicts -->
            <span
              v-if="activeAlertCount > 0 || highSeverityConflictCount > 0"
              class="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive"
            ></span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-64">
          <!-- Sound Alerts Section -->
          <div class="px-2 py-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Volume2 v-if="soundSettings.enabled" class="h-4 w-4 text-muted-foreground" />
                <VolumeX v-else class="h-4 w-4 text-muted-foreground" />
                <span class="text-sm font-medium">Sound Alerts</span>
              </div>
              <Switch
                :checked="soundSettings.enabled"
                @update:checked="soundSettings.enabled = $event"
              />
            </div>
            <div v-if="soundSettings.enabled" class="mt-2 px-1">
              <Slider
                :model-value="[soundSettings.volume]"
                @update:model-value="soundSettings.volume = $event[0]"
                :max="100"
                :step="5"
                class="w-full"
              />
              <span class="text-xs text-muted-foreground mt-1 block">Volume: {{ soundSettings.volume }}%</span>
              <!-- Per-event toggles -->
              <div class="mt-3 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Session finished</span>
                  <Switch
                    :checked="soundSettings.sessionEnd"
                    @update:checked="soundSettings.sessionEnd = $event"
                    class="scale-75"
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Tests failing</span>
                  <Switch
                    :checked="soundSettings.testFail"
                    @update:checked="soundSettings.testFail = $event"
                    class="scale-75"
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Tests passing</span>
                  <Switch
                    :checked="soundSettings.testPass"
                    @update:checked="soundSettings.testPass = $event"
                    class="scale-75"
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Tool errors</span>
                  <Switch
                    :checked="soundSettings.toolFailure"
                    @update:checked="soundSettings.toolFailure = $event"
                    class="scale-75"
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Waiting for input</span>
                  <Switch
                    :checked="soundSettings.waitingForInput"
                    @update:checked="soundSettings.waitingForInput = $event"
                    class="scale-75"
                  />
                </div>
              </div>
            </div>
          </div>
          <DropdownMenuSeparator />

          <!-- Dark Mode Toggle -->
          <DropdownMenuItem @click="toggleDarkMode" class="cursor-pointer">
            <Moon v-if="!isDark" class="h-4 w-4 mr-2" />
            <Sun v-else class="h-4 w-4 mr-2" />
            {{ isDark ? 'Light Mode' : 'Dark Mode' }}
          </DropdownMenuItem>

          <!-- Theme Manager -->
          <DropdownMenuItem @click="showThemeManager = true" class="cursor-pointer">
            <Palette class="h-4 w-4 mr-2" />
            Theme Manager
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <!-- Notifications -->
          <DropdownMenuItem @click="showNotificationSettings = true" class="cursor-pointer">
            <Bell class="h-4 w-4 mr-2" />
            Notifications
            <span
              v-if="notificationSettings.enabled"
              class="ml-auto h-2 w-2 rounded-full bg-status-active"
            ></span>
          </DropdownMenuItem>

          <!-- Alerts -->
          <DropdownMenuItem @click="showAlertPanel = true" class="cursor-pointer">
            <AlertTriangle class="h-4 w-4 mr-2" />
            Alerts
            <span
              v-if="activeAlertCount > 0"
              class="ml-auto text-xs font-bold text-destructive"
            >{{ activeAlertCount }}</span>
          </DropdownMenuItem>

          <!-- Conflicts -->
          <DropdownMenuItem @click="showConflictPanel = true" class="cursor-pointer">
            <GitMerge class="h-4 w-4 mr-2" />
            Conflicts
            <span
              v-if="conflicts.length > 0"
              class="ml-auto text-xs font-bold"
              :class="highSeverityConflictCount > 0 ? 'text-destructive' : 'text-status-idle'"
            >{{ conflicts.length }}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <!-- Retention Settings -->
          <DropdownMenuItem @click="showRetentionSettings = true" class="cursor-pointer">
            <Archive class="h-4 w-4 mr-2" />
            Data Retention
          </DropdownMenuItem>

          <!-- Add Project -->
          <DropdownMenuItem @click="showHookWizard = true" class="cursor-pointer">
            <Plus class="h-4 w-4 mr-2" />
            Add Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>

    <!-- Tab Navigation: 3 primary tabs + More dropdown -->
    <nav class="border-b border-border bg-card">
      <div class="max-w-6xl mx-auto w-full px-6 flex items-center gap-1" role="tablist">
      <!-- Primary Tabs -->
      <button
        v-for="tab in primaryTabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        role="tab"
        :aria-selected="activeTab === tab.id"
        class="px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
        :class="activeTab === tab.id
          ? 'text-foreground border-b-2 border-primary'
          : 'text-muted-foreground hover:text-foreground'"
      >
        {{ tab.label }}
      </button>

      <!-- More Dropdown -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            class="px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1"
            :class="isAdvancedTabActive
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'"
          >
            {{ activeAdvancedTabLabel || 'More' }}
            <ChevronDown class="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-48">
          <!-- Monitoring -->
          <div class="px-2 py-1.5">
            <span class="text-xs uppercase text-muted-foreground font-semibold">Monitoring</span>
          </div>
          <DropdownMenuItem
            v-for="tab in monitoringTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="cursor-pointer"
            :class="activeTab === tab.id ? 'bg-accent' : ''"
          >
            {{ tab.label }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <!-- Analysis -->
          <div class="px-2 py-1.5">
            <span class="text-xs uppercase text-muted-foreground font-semibold">Analysis</span>
          </div>
          <DropdownMenuItem
            v-for="tab in analysisTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="cursor-pointer"
            :class="activeTab === tab.id ? 'bg-accent' : ''"
          >
            {{ tab.label }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <!-- Advanced -->
          <div class="px-2 py-1.5">
            <span class="text-xs uppercase text-muted-foreground font-semibold">Advanced</span>
          </div>
          <DropdownMenuItem
            v-for="tab in advancedGroupTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="cursor-pointer"
            :class="activeTab === tab.id ? 'bg-accent' : ''"
          >
            {{ tab.label }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <!-- Configuration -->
          <div class="px-2 py-1.5">
            <span class="text-xs uppercase text-muted-foreground font-semibold">Configuration</span>
          </div>
          <DropdownMenuItem
            v-for="tab in configTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="cursor-pointer"
            :class="activeTab === tab.id ? 'bg-accent' : ''"
          >
            {{ tab.label }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Events-specific controls (only when Events tab is active) -->
      <div v-if="activeTab === 'events'" class="ml-auto flex items-center gap-1">
        <span class="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full font-medium">
          {{ events.length }}
        </span>
        <button
          @click="handleClearClick"
          class="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title="Clear events"
        >
          <Trash2 class="h-4 w-4" />
        </button>
        <button
          @click="showSearchPanel = !showSearchPanel"
          class="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          :title="showSearchPanel ? 'Hide search' : 'Show search'"
        >
          <Search class="h-4 w-4" />
        </button>
        <button
          @click="showFilters = !showFilters"
          class="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          :title="showFilters ? 'Hide filters' : 'Show filters'"
        >
          <Filter class="h-4 w-4" />
        </button>
      </div>
      </div>
    </nav>

    <!-- Connection Status Banner -->
    <div
      v-if="!isConnected || showReconnected"
      class="border-b transition-colors duration-300"
      :class="showReconnected
        ? 'bg-emerald-500/10 border-emerald-500/30'
        : 'bg-amber-500/10 border-amber-500/30'"
      role="alert"
    >
      <div class="max-w-6xl mx-auto w-full px-6 py-2 flex items-center gap-2 text-sm">
        <template v-if="showReconnected">
          <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
          <span class="text-emerald-700 dark:text-emerald-400 font-medium">Reconnected</span>
        </template>
        <template v-else>
          <WifiOff class="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span class="text-amber-700 dark:text-amber-400 font-medium">Connection lost &mdash; reconnecting...</span>
        </template>
      </div>
    </div>

    <!-- Alert Banner (shown on all tabs when alerts present) -->
    <AlertBanner
      v-if="!showAlertPanel"
      :alerts="activeAlerts"
      :dismiss-alert="dismissAlert"
    />

    <!-- ============ PRIMARY TABS ============ -->

    <!-- Dashboard Tab (SimpleDashboard) -->
    <div v-if="activeTab === 'dashboard'" class="flex-1 overflow-auto" role="tabpanel">
      <SimpleDashboard
        :projects="projects"
        :sessions="sessions"
        :events="events"
        :dev-logs="devLogs"
      />
    </div>

    <!-- Activity Tab (SimpleActivityFeed) -->
    <div v-if="activeTab === 'activity'" class="flex-1 overflow-auto" role="tabpanel">
      <SimpleActivityFeed
        :events="events"
        :sessions="sessions"
        :projects="projects"
      />
    </div>

    <!-- Dev Notes Tab (SimpleDevNotes) -->
    <div v-if="activeTab === 'devnotes'" class="flex-1 overflow-auto" role="tabpanel">
      <SimpleDevNotes
        :dev-logs="devLogs"
        :projects="projects"
      />
    </div>

    <!-- ============ ADVANCED TABS (via More dropdown) ============ -->

    <!-- Projects Tab (original ProjectOverview) -->
    <div v-if="activeTab === 'projects'" class="flex-1 overflow-auto" role="tabpanel">
      <ProjectOverview :projects="projects" :sessions="sessions" @add-project="showHookWizard = true" />
    </div>

    <!-- Events Tab -->
    <template v-if="activeTab === 'events'">
      <!-- Search Panel -->
      <SearchPanel
        v-if="showSearchPanel"
        @close="showSearchPanel = false"
      />

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

      <!-- Agent Swim Lane Container -->
      <div v-if="selectedAgentLanes.length > 0" class="w-full bg-muted px-3 py-4 mobile:px-2 mobile:py-2 overflow-hidden">
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
    <div v-if="activeTab === 'topology'" class="flex-1 overflow-auto" role="tabpanel">
      <AgentTopology :topology="topology" />
    </div>

    <!-- Dev Log Tab (original DevLogTimeline) -->
    <div v-if="activeTab === 'devlog'" class="flex-1 overflow-auto" role="tabpanel">
      <DevLogTimeline
        v-if="!replaySession"
        :dev-logs="devLogs"
        @replay="handleReplay"
      />
      <SessionReplay
        v-else
        :session-id="replaySession.sessionId"
        :source-app="replaySession.sourceApp"
        @back="replaySession = null"
      />
    </div>

    <!-- Summaries Tab -->
    <div v-if="activeTab === 'summaries'" class="flex-1 overflow-auto" role="tabpanel">
      <SummaryReport />
    </div>

    <!-- Costs Tab -->
    <div v-if="activeTab === 'costs'" class="flex-1 overflow-auto" role="tabpanel">
      <CostDashboard />
    </div>

    <!-- Metrics Tab -->
    <div v-if="activeTab === 'metrics'" class="flex-1 overflow-auto" role="tabpanel">
      <AgentMetrics />
    </div>

    <!-- Analytics Tab -->
    <div v-if="activeTab === 'analytics'" class="flex-1 overflow-auto p-4" role="tabpanel">
      <ActivityHeatmap :projects="projects" />
    </div>

    <!-- Webhooks Tab -->
    <div v-if="activeTab === 'webhooks'" class="flex-1 overflow-auto" role="tabpanel">
      <WebhookManager />
    </div>

    <!-- API Docs Tab -->
    <div v-if="activeTab === 'api-docs'" class="flex-1 overflow-auto" role="tabpanel">
      <ApiDocs />
    </div>

    <!-- Error message -->
    <div
      v-if="error"
      class="fixed bottom-4 left-4 mobile:bottom-3 mobile:left-3 mobile:right-3 bg-destructive/10 border border-destructive text-destructive px-3 py-2 rounded text-sm"
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

    <!-- Alert Panel -->
    <div
      v-if="showAlertPanel"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      @click.self="showAlertPanel = false"
    >
      <div class="bg-card rounded-lg shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden border border-border">
        <div class="flex items-center justify-between p-4 border-b border-border">
          <h2 class="text-xl font-bold">Active Alerts</h2>
          <button
            @click="showAlertPanel = false"
            class="p-2 rounded-md hover:bg-accent transition-colors"
            title="Close"
          >
            <X class="h-5 w-5" />
          </button>
        </div>
        <div class="overflow-y-auto max-h-[calc(80vh-5rem)]">
          <AlertBanner
            :alerts="activeAlerts"
            :dismiss-alert="dismissAlert"
          />
          <div v-if="activeAlerts.length === 0" class="p-8 text-center text-muted-foreground">
            No active alerts
          </div>
        </div>
      </div>
    </div>

    <!-- Conflict Panel -->
    <ConflictPanel
      v-if="showConflictPanel"
      :conflicts="conflicts"
      @close="showConflictPanel = false"
      @dismiss="handleConflictDismiss"
    />

    <!-- Hook Wizard -->
    <HookWizard
      :is-open="showHookWizard"
      @close="showHookWizard = false"
    />

    <!-- Retention Settings -->
    <RetentionSettings
      v-if="showRetentionSettings"
      @close="showRetentionSettings = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import type { TimeRange } from './types';
import { useWebSocket } from './composables/useWebSocket';
import { useProjects } from './composables/useProjects';
import { useThemes } from './composables/useThemes';
import { useEventColors } from './composables/useEventColors';
import { useNotifications } from './composables/useNotifications';
import { useCommandPalette } from './composables/useCommandPalette';
import { useAlerts } from './composables/useAlerts';
import { useSoundAlerts } from './composables/useSoundAlerts';

// Icons
import {
  Settings, ChevronDown, Moon, Sun, Palette, Bell, AlertTriangle,
  GitMerge, Archive, Plus, Search, Filter, Trash2, Volume2, VolumeX, X, WifiOff
} from 'lucide-vue-next';

// shadcn UI
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from './components/ui/dropdown-menu';
import { Switch } from './components/ui/switch';
import { Slider } from './components/ui/slider';

// New simplified views
import SimpleDashboard from './components/SimpleDashboard.vue';
import SimpleActivityFeed from './components/SimpleActivityFeed.vue';
import SimpleDevNotes from './components/SimpleDevNotes.vue';

// Existing components (advanced tabs + overlays)
import EventTimeline from './components/EventTimeline.vue';
import FilterPanel from './components/FilterPanel.vue';
import SearchPanel from './components/SearchPanel.vue';
import StickScrollButton from './components/StickScrollButton.vue';
import LivePulseChart from './components/LivePulseChart.vue';
import ThemeManager from './components/ThemeManager.vue';
import CommandPalette from './components/CommandPalette.vue';
import ToastNotification from './components/ToastNotification.vue';
import AgentSwimLaneContainer from './components/AgentSwimLaneContainer.vue';
import ProjectOverview from './components/ProjectOverview.vue';
import AgentTopology from './components/AgentTopology.vue';
import DevLogTimeline from './components/DevLogTimeline.vue';
import SessionReplay from './components/SessionReplay.vue';
import SummaryReport from './components/SummaryReport.vue';
import NotificationSettings from './components/NotificationSettings.vue';
import CostDashboard from './components/CostDashboard.vue';
import AgentMetrics from './components/AgentMetrics.vue';
import ConflictPanel from './components/ConflictPanel.vue';
import AlertBanner from './components/AlertBanner.vue';
import HookWizard from './components/HookWizard.vue';
import ActivityHeatmap from './components/ActivityHeatmap.vue';
import RetentionSettings from './components/RetentionSettings.vue';
import WebhookManager from './components/WebhookManager.vue';
import ApiDocs from './components/ApiDocs.vue';
import { WS_URL } from './config';

// === Tab navigation ===
type TabId = 'dashboard' | 'activity' | 'devnotes' | 'projects' | 'events' | 'topology' | 'devlog' | 'summaries' | 'costs' | 'metrics' | 'analytics' | 'webhooks' | 'api-docs';

const primaryTabs: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'activity', label: 'Activity' },
  { id: 'devnotes', label: 'Dev Notes' },
];

const advancedTabs: { id: TabId; label: string }[] = [
  { id: 'projects', label: 'Projects (Advanced)' },
  { id: 'events', label: 'Events' },
  { id: 'topology', label: 'Topology' },
  { id: 'devlog', label: 'Dev Log' },
  { id: 'summaries', label: 'Summaries' },
  { id: 'costs', label: 'Costs' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'api-docs', label: 'API Docs' },
];

// Categorized groups for the More dropdown
const monitoringTabs = advancedTabs.filter(t => ['events', 'topology', 'metrics'].includes(t.id));
const analysisTabs = advancedTabs.filter(t => ['summaries', 'costs', 'analytics'].includes(t.id));
const advancedGroupTabs = advancedTabs.filter(t => ['projects', 'devlog'].includes(t.id));
const configTabs = advancedTabs.filter(t => ['webhooks', 'api-docs'].includes(t.id));

const advancedTabIds = new Set(advancedTabs.map(t => t.id));

const activeTab = ref<TabId>('dashboard');

const isAdvancedTabActive = computed(() => advancedTabIds.has(activeTab.value));

const activeAdvancedTabLabel = computed(() => {
  if (!isAdvancedTabActive.value) return '';
  return advancedTabs.find(t => t.id === activeTab.value)?.label || '';
});

// === WebSocket connection ===
const { events, isConnected, error, clearEvents, projects, sessions, devLogs: wsDevLogs, topology, conflicts, alerts } = useWebSocket(WS_URL);

// === Connection status banner ===
const showReconnected = ref(false);
let wasDisconnected = false;
let reconnectedTimer: ReturnType<typeof setTimeout> | null = null;

watch(isConnected, (connected) => {
  if (!connected) {
    wasDisconnected = true;
    showReconnected.value = false;
    if (reconnectedTimer) {
      clearTimeout(reconnectedTimer);
      reconnectedTimer = null;
    }
  } else if (wasDisconnected) {
    showReconnected.value = true;
    reconnectedTimer = setTimeout(() => {
      showReconnected.value = false;
      reconnectedTimer = null;
    }, 2000);
  }
});

onUnmounted(() => {
  if (reconnectedTimer) clearTimeout(reconnectedTimer);
});

// === Projects and dev logs ===
const { devLogs } = useProjects(projects, sessions, wsDevLogs);

// === Alerts management ===
const { dismissAlert, activeAlerts, activeAlertCount } = useAlerts(alerts);

// === Theme management ===
useThemes();

// === Dark mode toggle ===
const isDark = ref(document.documentElement.classList.contains('dark'));
function toggleDarkMode() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  localStorage.setItem('devpulse-dark-mode', isDark.value ? 'dark' : 'light');
}

// === Event colors ===
const { getHexColorForApp } = useEventColors();

// === Notifications ===
const { settings: notificationSettings, requestPermission: requestNotificationPermission } = useNotifications(events);

// === Sound Alerts ===
const { settings: soundSettings } = useSoundAlerts(events);

// Warm up AudioContext on first user interaction (browser autoplay policy)
let audioWarmedUp = false;
function warmUpAudio() {
  if (audioWarmedUp) return;
  audioWarmedUp = true;
  try {
    const ctx = new AudioContext();
    ctx.resume();
    // Play a silent tone to fully unlock audio
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch { /* ignore */ }
  document.removeEventListener('click', warmUpAudio);
  document.removeEventListener('keydown', warmUpAudio);
}
document.addEventListener('click', warmUpAudio, { once: true });
document.addEventListener('keydown', warmUpAudio, { once: true });

// === Command Palette ===
const { registerAction, setFilterCallbacks } = useCommandPalette();

// === Filters (events tab) ===
const filters = ref({
  sourceApp: '',
  sessionId: '',
  eventType: ''
});

// === UI state ===
const stickToBottom = ref(true);
const showThemeManager = ref(false);
const showFilters = ref(false);
const showSearchPanel = ref(false);
const showNotificationSettings = ref(false);
const showConflictPanel = ref(false);
const showAlertPanel = ref(false);
const showHookWizard = ref(false);
const showRetentionSettings = ref(false);
const uniqueAppNames = ref<string[]>([]);
const allAppNames = ref<string[]>([]);
const selectedAgentLanes = ref<string[]>([]);
const currentTimeRange = ref<TimeRange>('1m');
const replaySession = ref<{ sessionId: string; sourceApp: string } | null>(null);

// === Computed ===
const highSeverityConflictCount = computed(() => {
  return conflicts.value.filter(c => c.severity === 'high').length;
});

// === Toast notifications ===
interface Toast {
  id: number;
  agentName: string;
  agentColor: string;
}
const toasts = ref<Toast[]>([]);
let toastIdCounter = 0;
const seenAgents = new Set<string>();

watch(uniqueAppNames, (newAppNames) => {
  newAppNames.forEach(appName => {
    if (!seenAgents.has(appName)) {
      seenAgents.add(appName);
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

// === Event handlers ===
const toggleAgentLane = (agentName: string) => {
  const index = selectedAgentLanes.value.indexOf(agentName);
  if (index >= 0) {
    selectedAgentLanes.value.splice(index, 1);
  } else {
    selectedAgentLanes.value.push(agentName);
  }
};

const handleClearClick = () => {
  clearEvents();
  selectedAgentLanes.value = [];
};

const handleConflictDismiss = (id: string) => {
  console.log('Conflict dismissed:', id);
};

const handleReplay = (payload: { sessionId: string; sourceApp: string }) => {
  replaySession.value = payload;
};

// === Command palette actions ===
onMounted(() => {
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
      activeTab.value = 'dashboard';
    }
  });

  registerAction({
    id: 'clear-events',
    label: 'Clear Events',
    category: 'action',
    keywords: ['clear', 'events', 'reset', 'delete'],
    icon: '🗑️',
    execute: handleClearClick
  });

  registerAction({
    id: 'toggle-theme',
    label: 'Open Theme Manager',
    category: 'settings',
    keywords: ['theme', 'color', 'appearance', 'style'],
    icon: '🎨',
    execute: () => { showThemeManager.value = true; }
  });

  registerAction({
    id: 'toggle-dark-mode',
    label: 'Toggle Dark Mode',
    category: 'settings',
    keywords: ['dark', 'light', 'mode', 'theme'],
    icon: '🌙',
    execute: toggleDarkMode
  });

  registerAction({
    id: 'toggle-search',
    label: 'Toggle Search Panel',
    category: 'action',
    keywords: ['search', 'find', 'query'],
    icon: '🔍',
    execute: () => { showSearchPanel.value = !showSearchPanel.value; }
  });

  registerAction({
    id: 'toggle-filters',
    label: 'Toggle Filters Panel',
    category: 'action',
    keywords: ['filter', 'search', 'query'],
    icon: '📊',
    execute: () => { showFilters.value = !showFilters.value; }
  });

  registerAction({
    id: 'toggle-notifications',
    label: 'Notification Settings',
    category: 'settings',
    keywords: ['notification', 'bell', 'alerts'],
    icon: '🔔',
    execute: () => { showNotificationSettings.value = true; }
  });

  registerAction({
    id: 'toggle-sound-alerts',
    label: 'Toggle Sound Alerts',
    category: 'settings',
    keywords: ['sound', 'audio', 'alerts', 'mute'],
    icon: '🔊',
    execute: () => { soundSettings.value.enabled = !soundSettings.value.enabled; }
  });

  registerAction({
    id: 'toggle-alerts',
    label: 'View Alerts',
    category: 'action',
    keywords: ['alert', 'notification', 'warning'],
    icon: '🔔',
    execute: () => { showAlertPanel.value = true; }
  });

  registerAction({
    id: 'toggle-conflicts',
    label: 'View File Conflicts',
    category: 'action',
    keywords: ['conflict', 'file', 'warning'],
    icon: '⚠️',
    execute: () => { showConflictPanel.value = true; }
  });

  // Navigation actions
  registerAction({
    id: 'nav-dashboard',
    label: 'Go to Dashboard',
    category: 'navigate',
    keywords: ['dashboard', 'home', 'overview'],
    icon: '📁',
    execute: () => { activeTab.value = 'dashboard'; }
  });

  registerAction({
    id: 'nav-activity',
    label: 'Go to Activity Feed',
    category: 'navigate',
    keywords: ['activity', 'feed', 'stream'],
    icon: '📋',
    execute: () => { activeTab.value = 'activity'; }
  });

  registerAction({
    id: 'nav-devnotes',
    label: 'Go to Dev Notes',
    category: 'navigate',
    keywords: ['devnotes', 'notes', 'log'],
    icon: '📝',
    execute: () => { activeTab.value = 'devnotes'; }
  });

  registerAction({
    id: 'nav-projects',
    label: 'Go to Projects (Advanced)',
    category: 'navigate',
    keywords: ['projects', 'overview'],
    icon: '📁',
    execute: () => { activeTab.value = 'projects'; }
  });

  registerAction({
    id: 'nav-events',
    label: 'Go to Events Tab',
    category: 'navigate',
    keywords: ['events', 'timeline', 'stream'],
    icon: '📋',
    execute: () => { activeTab.value = 'events'; }
  });

  registerAction({
    id: 'nav-topology',
    label: 'Go to Topology Tab',
    category: 'navigate',
    keywords: ['topology', 'graph', 'agents'],
    icon: '🕸️',
    execute: () => { activeTab.value = 'topology'; }
  });

  registerAction({
    id: 'nav-devlog',
    label: 'Go to Dev Log Tab',
    category: 'navigate',
    keywords: ['devlog', 'log', 'history'],
    icon: '📝',
    execute: () => { activeTab.value = 'devlog'; }
  });

  registerAction({
    id: 'nav-summaries',
    label: 'Go to Summaries Tab',
    category: 'navigate',
    keywords: ['summaries', 'summary', 'report'],
    icon: '📊',
    execute: () => { activeTab.value = 'summaries'; }
  });

  registerAction({
    id: 'nav-costs',
    label: 'Go to Costs Tab',
    category: 'navigate',
    keywords: ['costs', 'pricing', 'money'],
    icon: '💰',
    execute: () => { activeTab.value = 'costs'; }
  });

  registerAction({
    id: 'nav-metrics',
    label: 'Go to Metrics Tab',
    category: 'navigate',
    keywords: ['metrics', 'performance', 'stats'],
    icon: '📈',
    execute: () => { activeTab.value = 'metrics'; }
  });

  registerAction({
    id: 'nav-analytics',
    label: 'Go to Analytics Tab',
    category: 'navigate',
    keywords: ['analytics', 'heatmap', 'activity'],
    icon: '📅',
    execute: () => { activeTab.value = 'analytics'; }
  });

  registerAction({
    id: 'nav-webhooks',
    label: 'Go to Webhooks Tab',
    category: 'navigate',
    keywords: ['webhooks', 'integrations', 'notifications'],
    icon: '🔗',
    execute: () => { activeTab.value = 'webhooks'; }
  });

  registerAction({
    id: 'nav-api-docs',
    label: 'Go to API Docs Tab',
    category: 'navigate',
    keywords: ['api', 'docs', 'documentation', 'reference'],
    icon: '📚',
    execute: () => { activeTab.value = 'api-docs'; }
  });

  registerAction({
    id: 'open-retention',
    label: 'Data Retention Settings',
    category: 'settings',
    keywords: ['retention', 'archive', 'cleanup', 'data', 'settings'],
    icon: '⚙️',
    execute: () => { showRetentionSettings.value = true; }
  });
});
</script>
