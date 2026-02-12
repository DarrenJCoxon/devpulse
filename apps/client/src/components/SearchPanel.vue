<template>
  <div class="bg-[var(--theme-bg-primary)] border-b-2 border-[var(--theme-primary)] px-4 py-4 shadow-lg">
    <!-- Search Input -->
    <div class="mb-4">
      <div class="relative">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search events, sessions, and dev logs..."
          class="w-full bg-[var(--theme-bg-primary)] border-2 border-[var(--theme-primary)]/30 focus:border-[var(--theme-primary)] rounded-xl px-4 py-3 pl-12 text-lg text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]/20 transition-all"
          @input="handleSearchInput"
        />
        <!-- Search Icon -->
        <div class="absolute left-4 top-1/2 -translate-y-1/2 text-2xl">
          🔍
        </div>
        <!-- Clear Button -->
        <button
          v-if="searchQuery"
          @click="clearSearch"
          class="absolute right-12 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-[var(--theme-hover-bg)] transition-colors"
          title="Clear search"
        >
          <span class="text-lg">✕</span>
        </button>
        <!-- Regex Toggle -->
        <button
          @click="isRegexMode = !isRegexMode"
          :class="[
            'absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-xs font-mono transition-colors',
            isRegexMode
              ? 'bg-[var(--theme-primary)] text-white'
              : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-tertiary)] hover:bg-[var(--theme-hover-bg)]'
          ]"
          title="Toggle regex mode"
        >
          .*
        </button>
      </div>
    </div>

    <!-- Results Container -->
    <div v-if="searchQuery && !isLoading && hasResults" class="space-y-4">
      <!-- Events Results -->
      <div v-if="results.events.count > 0" class="bg-[var(--theme-bg-secondary)] rounded-lg border border-[var(--theme-border-primary)] overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-tertiary)]">
          <h3 class="text-sm font-bold text-[var(--theme-text-primary)] flex items-center gap-2">
            Events
            <span class="px-2 py-0.5 rounded-full bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] text-xs font-semibold">
              {{ results.events.count }}
            </span>
          </h3>
          <button
            v-if="results.events.count > 5 && !expandedSections.events"
            @click="expandedSections.events = true"
            class="text-xs text-[var(--theme-primary)] hover:text-[var(--theme-primary-dark)] font-medium"
          >
            Show all {{ results.events.count }} results
          </button>
          <button
            v-if="expandedSections.events"
            @click="expandedSections.events = false"
            class="text-xs text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-primary)] font-medium"
          >
            Show less
          </button>
        </div>
        <div class="divide-y divide-[var(--theme-border-secondary)]">
          <div
            v-for="(event, index) in displayedEvents"
            :key="event.id || index"
            class="px-4 py-3 hover:bg-[var(--theme-hover-bg)] transition-colors"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-semibold text-[var(--theme-primary)]">
                    {{ event.hook_event_type }}
                  </span>
                  <span class="text-xs text-[var(--theme-text-tertiary)]">
                    {{ event.source_app }}:{{ event.session_id.slice(0, 8) }}
                  </span>
                </div>
                <p class="text-sm text-[var(--theme-text-secondary)] truncate">
                  {{ event.summary || JSON.stringify(event.payload).slice(0, 100) }}
                </p>
              </div>
              <span class="text-xs text-[var(--theme-text-tertiary)] whitespace-nowrap">
                {{ formatTimestamp(event.timestamp) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Sessions Results -->
      <div v-if="results.sessions.count > 0" class="bg-[var(--theme-bg-secondary)] rounded-lg border border-[var(--theme-border-primary)] overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-tertiary)]">
          <h3 class="text-sm font-bold text-[var(--theme-text-primary)] flex items-center gap-2">
            Sessions
            <span class="px-2 py-0.5 rounded-full bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] text-xs font-semibold">
              {{ results.sessions.count }}
            </span>
          </h3>
          <button
            v-if="results.sessions.count > 5 && !expandedSections.sessions"
            @click="expandedSections.sessions = true"
            class="text-xs text-[var(--theme-primary)] hover:text-[var(--theme-primary-dark)] font-medium"
          >
            Show all {{ results.sessions.count }} results
          </button>
          <button
            v-if="expandedSections.sessions"
            @click="expandedSections.sessions = false"
            class="text-xs text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-primary)] font-medium"
          >
            Show less
          </button>
        </div>
        <div class="divide-y divide-[var(--theme-border-secondary)]">
          <div
            v-for="(session, index) in displayedSessions"
            :key="session.id || index"
            class="px-4 py-3 hover:bg-[var(--theme-hover-bg)] transition-colors"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-semibold text-[var(--theme-primary)]">
                    {{ session.source_app }}:{{ session.session_id.slice(0, 8) }}
                  </span>
                  <span class="text-xs text-[var(--theme-text-tertiary)]">
                    {{ session.status }}
                  </span>
                </div>
                <p class="text-sm text-[var(--theme-text-secondary)]">
                  {{ session.project_name }} - {{ session.current_branch }}
                </p>
              </div>
              <span class="text-xs text-[var(--theme-text-tertiary)] whitespace-nowrap">
                {{ formatTimestamp(session.last_event_at) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Dev Logs Results -->
      <div v-if="results.devlogs.count > 0" class="bg-[var(--theme-bg-secondary)] rounded-lg border border-[var(--theme-border-primary)] overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-tertiary)]">
          <h3 class="text-sm font-bold text-[var(--theme-text-primary)] flex items-center gap-2">
            Dev Logs
            <span class="px-2 py-0.5 rounded-full bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] text-xs font-semibold">
              {{ results.devlogs.count }}
            </span>
          </h3>
          <button
            v-if="results.devlogs.count > 5 && !expandedSections.devlogs"
            @click="expandedSections.devlogs = true"
            class="text-xs text-[var(--theme-primary)] hover:text-[var(--theme-primary-dark)] font-medium"
          >
            Show all {{ results.devlogs.count }} results
          </button>
          <button
            v-if="expandedSections.devlogs"
            @click="expandedSections.devlogs = false"
            class="text-xs text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-primary)] font-medium"
          >
            Show less
          </button>
        </div>
        <div class="divide-y divide-[var(--theme-border-secondary)]">
          <div
            v-for="(log, index) in displayedDevLogs"
            :key="log.id || index"
            class="px-4 py-3 hover:bg-[var(--theme-hover-bg)] transition-colors"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-semibold text-[var(--theme-primary)]">
                    {{ log.project_name }}
                  </span>
                  <span class="text-xs text-[var(--theme-text-tertiary)]">
                    {{ log.branch }}
                  </span>
                </div>
                <p class="text-sm text-[var(--theme-text-secondary)] line-clamp-2">
                  {{ log.summary }}
                </p>
              </div>
              <span class="text-xs text-[var(--theme-text-tertiary)] whitespace-nowrap">
                {{ formatTimestamp(log.ended_at) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-[var(--theme-primary)] border-t-transparent"></div>
      <p class="text-sm text-[var(--theme-text-tertiary)] mt-2">Searching...</p>
    </div>

    <!-- No Results -->
    <div v-if="searchQuery && !isLoading && !hasResults" class="text-center py-8">
      <p class="text-sm text-[var(--theme-text-tertiary)]">No results found for "{{ searchQuery }}"</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { API_BASE_URL } from '../config';
import type { HookEvent } from '../types';

interface Session {
  id?: number;
  session_id: string;
  source_app: string;
  project_name: string;
  current_branch: string;
  status: string;
  last_event_at: number;
}

interface DevLog {
  id?: number;
  session_id: string;
  source_app: string;
  project_name: string;
  branch: string;
  summary: string;
  ended_at: number;
}

const searchQuery = ref('');
const isRegexMode = ref(false);
const isLoading = ref(false);
const results = ref<{
  events: { count: number; results: HookEvent[] };
  sessions: { count: number; results: Session[] };
  devlogs: { count: number; results: DevLog[] };
}>({
  events: { count: 0, results: [] },
  sessions: { count: 0, results: [] },
  devlogs: { count: 0, results: [] }
});

const expandedSections = ref({
  events: false,
  sessions: false,
  devlogs: false
});

// Debounce timer
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const handleSearchInput = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    performSearch();
  }, 300);
};

const performSearch = async () => {
  if (!searchQuery.value.trim()) {
    results.value = {
      events: { count: 0, results: [] },
      sessions: { count: 0, results: [] },
      devlogs: { count: 0, results: [] }
    };
    return;
  }

  isLoading.value = true;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/search?q=${encodeURIComponent(searchQuery.value)}&type=all&limit=20`
    );

    if (response.ok) {
      results.value = await response.json();
    } else {
      console.error('Search failed:', response.statusText);
    }
  } catch (error) {
    console.error('Search error:', error);
  } finally {
    isLoading.value = false;
  }
};

const clearSearch = () => {
  searchQuery.value = '';
  results.value = {
    events: { count: 0, results: [] },
    sessions: { count: 0, results: [] },
    devlogs: { count: 0, results: [] }
  };
  expandedSections.value = {
    events: false,
    sessions: false,
    devlogs: false
  };
};

const hasResults = computed(() => {
  return results.value.events.count > 0 ||
         results.value.sessions.count > 0 ||
         results.value.devlogs.count > 0;
});

const displayedEvents = computed(() => {
  return expandedSections.value.events
    ? results.value.events.results
    : results.value.events.results.slice(0, 5);
});

const displayedSessions = computed(() => {
  return expandedSections.value.sessions
    ? results.value.sessions.results
    : results.value.sessions.results.slice(0, 5);
});

const displayedDevLogs = computed(() => {
  return expandedSections.value.devlogs
    ? results.value.devlogs.results
    : results.value.devlogs.results.slice(0, 5);
});

const formatTimestamp = (timestamp: number | undefined): string => {
  if (!timestamp) return 'N/A';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
};
</script>
