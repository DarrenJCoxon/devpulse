<template>
  <div class="bg-gradient-to-r from-[var(--theme-bg-primary)] to-[var(--theme-bg-secondary)] border-b-2 border-[var(--theme-primary)] px-3 py-4 mobile:py-2 shadow-lg">
    <!-- Saved Filter Presets -->
    <div v-if="savedFilters.length > 0" class="mb-3 flex flex-wrap gap-2 items-center">
      <span class="text-xs font-semibold text-[var(--theme-text-tertiary)]">Saved Filters:</span>
      <button
        v-for="filter in savedFilters"
        :key="filter.id"
        @click="applyFilter(filter)"
        @contextmenu.prevent="showFilterMenu(filter, $event)"
        class="bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] rounded-full px-3 py-1 text-sm font-medium hover:bg-[var(--theme-primary)]/20 transition-colors cursor-pointer relative group"
        :title="`Right-click to manage | Query: ${filter.query || 'none'}`"
      >
        {{ filter.name }}
        <!-- Quick delete button on hover -->
        <span
          @click.stop="handleDeleteFilter(filter.id)"
          class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          title="Delete filter"
        >
          ×
        </span>
      </button>
    </div>

    <div class="flex flex-wrap gap-3 items-center mobile:flex-col mobile:items-stretch">
      <div class="flex-1 min-w-0 mobile:w-full">
        <label class="block text-base mobile:text-sm font-bold text-[var(--theme-primary)] mb-1.5 drop-shadow-sm">
          Source App
        </label>
        <select
          v-model="localFilters.sourceApp"
          @change="updateFilters"
          class="w-full px-4 py-2 mobile:px-2 mobile:py-1.5 text-base mobile:text-sm border border-[var(--theme-primary)] rounded-lg focus:ring-2 focus:ring-[var(--theme-primary)]/30 focus:border-[var(--theme-primary-dark)] bg-[var(--theme-bg-primary)] text-[var(--theme-text-primary)] shadow-md hover:shadow-lg transition-all duration-200"
        >
          <option value="">All Sources</option>
          <option v-for="app in filterOptions.source_apps" :key="app" :value="app">
            {{ app }}
          </option>
        </select>
      </div>
      
      <div class="flex-1 min-w-0 mobile:w-full">
        <label class="block text-base mobile:text-sm font-bold text-[var(--theme-primary)] mb-1.5 drop-shadow-sm">
          Session ID
        </label>
        <select
          v-model="localFilters.sessionId"
          @change="updateFilters"
          class="w-full px-4 py-2 mobile:px-2 mobile:py-1.5 text-base mobile:text-sm border border-[var(--theme-primary)] rounded-lg focus:ring-2 focus:ring-[var(--theme-primary)]/30 focus:border-[var(--theme-primary-dark)] bg-[var(--theme-bg-primary)] text-[var(--theme-text-primary)] shadow-md hover:shadow-lg transition-all duration-200"
        >
          <option value="">All Sessions</option>
          <option v-for="session in filterOptions.session_ids" :key="session" :value="session">
            {{ session.slice(0, 8) }}...
          </option>
        </select>
      </div>
      
      <div class="flex-1 min-w-0 mobile:w-full">
        <label class="block text-base mobile:text-sm font-bold text-[var(--theme-primary)] mb-1.5 drop-shadow-sm">
          Event Type
        </label>
        <select
          v-model="localFilters.eventType"
          @change="updateFilters"
          class="w-full px-4 py-2 mobile:px-2 mobile:py-1.5 text-base mobile:text-sm border border-[var(--theme-primary)] rounded-lg focus:ring-2 focus:ring-[var(--theme-primary)]/30 focus:border-[var(--theme-primary-dark)] bg-[var(--theme-bg-primary)] text-[var(--theme-text-primary)] shadow-md hover:shadow-lg transition-all duration-200"
        >
          <option value="">All Types</option>
          <option v-for="type in filterOptions.hook_event_types" :key="type" :value="type">
            {{ type }}
          </option>
        </select>
      </div>
      
      <button
        v-if="hasActiveFilters"
        @click="clearFilters"
        class="px-4 py-2 mobile:px-2 mobile:py-1.5 mobile:w-full text-base mobile:text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
      >
        Clear Filters
      </button>

      <!-- Save Filter Button -->
      <button
        v-if="hasActiveFilters"
        @click="showSaveDialog = true"
        class="px-4 py-2 mobile:px-2 mobile:py-1.5 mobile:w-full text-base mobile:text-sm font-medium text-white bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-dark)] rounded-md transition-colors shadow-md"
        title="Save current filters"
      >
        💾 Save
      </button>
    </div>

    <!-- Save Filter Dialog -->
    <div
      v-if="showSaveDialog"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      @click.self="showSaveDialog = false"
    >
      <div class="bg-[var(--theme-bg-primary)] rounded-lg shadow-2xl max-w-md w-full border border-[var(--theme-border-primary)] p-6">
        <h3 class="text-lg font-bold text-[var(--theme-text-primary)] mb-4">Save Filter Preset</h3>
        <input
          v-model="filterName"
          type="text"
          placeholder="Enter filter name..."
          class="w-full px-4 py-2 border border-[var(--theme-border-primary)] rounded-lg bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)] mb-4"
          @keyup.enter="handleSaveFilter"
        />
        <div class="flex gap-2 justify-end">
          <button
            @click="showSaveDialog = false"
            class="px-4 py-2 text-sm font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            @click="handleSaveFilter"
            :disabled="!filterName.trim()"
            class="px-4 py-2 text-sm font-medium text-white bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>

    <!-- Filter Menu (Rename/Delete) -->
    <div
      v-if="contextMenu.show"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      class="fixed z-50 bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg shadow-2xl py-1 min-w-[150px]"
    >
      <button
        @click="handleRenameFilter"
        class="w-full px-4 py-2 text-left text-sm text-[var(--theme-text-primary)] hover:bg-[var(--theme-hover-bg)] transition-colors"
      >
        Rename
      </button>
      <button
        @click="handleDeleteFilterFromMenu"
        class="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-[var(--theme-hover-bg)] transition-colors"
      >
        Delete
      </button>
    </div>

    <!-- Rename Dialog -->
    <div
      v-if="showRenameDialog"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      @click.self="showRenameDialog = false"
    >
      <div class="bg-[var(--theme-bg-primary)] rounded-lg shadow-2xl max-w-md w-full border border-[var(--theme-border-primary)] p-6">
        <h3 class="text-lg font-bold text-[var(--theme-text-primary)] mb-4">Rename Filter</h3>
        <input
          v-model="renameValue"
          type="text"
          placeholder="Enter new name..."
          class="w-full px-4 py-2 border border-[var(--theme-border-primary)] rounded-lg bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)] mb-4"
          @keyup.enter="confirmRename"
        />
        <div class="flex gap-2 justify-end">
          <button
            @click="showRenameDialog = false"
            class="px-4 py-2 text-sm font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            @click="confirmRename"
            :disabled="!renameValue.trim()"
            class="px-4 py-2 text-sm font-medium text-white bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { FilterOptions } from '../types';
import { API_BASE_URL } from '../config';
import { useEventSearch } from '../composables/useEventSearch';

const props = defineProps<{
  filters: {
    sourceApp: string;
    sessionId: string;
    eventType: string;
  };
}>();

const emit = defineEmits<{
  'update:filters': [filters: typeof props.filters];
}>();

// Use the event search composable for saved filters
const { savedFilters, saveFilter, deleteFilter, renameFilter: renameSavedFilter } = useEventSearch();

const filterOptions = ref<FilterOptions>({
  source_apps: [],
  session_ids: [],
  hook_event_types: []
});

const localFilters = ref({ ...props.filters });

// UI state
const showSaveDialog = ref(false);
const filterName = ref('');
const showRenameDialog = ref(false);
const renameValue = ref('');
const renameFilterId = ref<string | null>(null);
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  filterId: null as string | null
});

const hasActiveFilters = computed(() => {
  return localFilters.value.sourceApp || localFilters.value.sessionId || localFilters.value.eventType;
});

const updateFilters = () => {
  emit('update:filters', { ...localFilters.value });
};

const clearFilters = () => {
  localFilters.value = {
    sourceApp: '',
    sessionId: '',
    eventType: ''
  };
  updateFilters();
};

// Save current filter combination
const handleSaveFilter = () => {
  if (!filterName.value.trim()) return;

  saveFilter(filterName.value, {
    query: '',  // SearchPanel handles query separately
    sourceApp: localFilters.value.sourceApp,
    sessionId: localFilters.value.sessionId,
    eventType: localFilters.value.eventType
  });

  filterName.value = '';
  showSaveDialog.value = false;
};

// Apply a saved filter
const applyFilter = (filter: any) => {
  localFilters.value = {
    sourceApp: filter.sourceApp,
    sessionId: filter.sessionId,
    eventType: filter.eventType
  };
  updateFilters();
};

// Delete a filter
const handleDeleteFilter = (id: string) => {
  if (confirm('Are you sure you want to delete this filter preset?')) {
    deleteFilter(id);
  }
};

// Show context menu on right-click
const showFilterMenu = (filter: any, event: MouseEvent) => {
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    filterId: filter.id
  };
};

// Close context menu when clicking outside
const closeContextMenu = () => {
  contextMenu.value.show = false;
};

// Handle rename from context menu
const handleRenameFilter = () => {
  const filter = savedFilters.value.find(f => f.id === contextMenu.value.filterId);
  if (filter) {
    renameValue.value = filter.name;
    renameFilterId.value = filter.id;
    showRenameDialog.value = true;
  }
  closeContextMenu();
};

// Handle delete from context menu
const handleDeleteFilterFromMenu = () => {
  if (contextMenu.value.filterId) {
    handleDeleteFilter(contextMenu.value.filterId);
  }
  closeContextMenu();
};

// Confirm rename
const confirmRename = () => {
  if (!renameValue.value.trim() || !renameFilterId.value) return;

  renameSavedFilter(renameFilterId.value, renameValue.value);

  renameValue.value = '';
  renameFilterId.value = null;
  showRenameDialog.value = false;
};

const fetchFilterOptions = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/events/filter-options`);
    if (response.ok) {
      filterOptions.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to fetch filter options:', error);
  }
};

onMounted(() => {
  fetchFilterOptions();
  // Refresh filter options periodically
  setInterval(fetchFilterOptions, 10000);

  // Close context menu on any click
  document.addEventListener('click', closeContextMenu);
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
});
</script>