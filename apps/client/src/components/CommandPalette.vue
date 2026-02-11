<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-start justify-center p-4">
      <!-- Backdrop -->
      <div
        class="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        @click="close"
      ></div>

      <!-- Modal -->
      <div
        class="relative bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-xl shadow-2xl max-w-lg w-full mx-auto mt-[15vh] z-10 overflow-hidden"
        @click.stop
      >
        <!-- Search Input -->
        <div class="relative">
          <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <span class="text-xl">🔍</span>
          </div>
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            placeholder="Search commands..."
            class="w-full pl-12 pr-4 py-4 bg-[var(--theme-bg-secondary)] border-b border-[var(--theme-border-primary)] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-tertiary)] focus:outline-none text-base"
            @keydown.down.prevent="moveSelectionDown"
            @keydown.up.prevent="moveSelectionUp"
            @keydown.enter.prevent="executeSelectedAction"
            @keydown.escape.prevent="close"
          />
        </div>

        <!-- Results List -->
        <div class="max-h-[60vh] overflow-y-auto">
          <!-- No results message -->
          <div
            v-if="filteredActions.length === 0"
            class="px-4 py-8 text-center text-[var(--theme-text-tertiary)]"
          >
            <span class="text-4xl mb-2 block">🔍</span>
            <p class="text-sm">No matching commands</p>
          </div>

          <!-- Results grouped by category -->
          <div v-else>
            <!-- Navigate category -->
            <div v-if="groupedActions.navigate.length > 0" class="py-2">
              <div class="px-4 py-2">
                <h3 class="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-tertiary)]">
                  Navigate
                </h3>
              </div>
              <button
                v-for="action in groupedActions.navigate"
                :key="action.id"
                :class="[
                  'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                  isSelected(action) ? 'bg-[var(--theme-primary)]/10 border-l-2 border-[var(--theme-primary)]' : 'hover:bg-[var(--theme-bg-secondary)]'
                ]"
                @click="executeAction(action)"
              >
                <span class="text-xl">{{ action.icon }}</span>
                <span class="flex-1 text-sm text-[var(--theme-text-primary)]">{{ action.label }}</span>
              </button>
            </div>

            <!-- Filter category -->
            <div v-if="groupedActions.filter.length > 0" class="py-2">
              <div class="px-4 py-2">
                <h3 class="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-tertiary)]">
                  Filter
                </h3>
              </div>
              <button
                v-for="action in groupedActions.filter"
                :key="action.id"
                :class="[
                  'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                  isSelected(action) ? 'bg-[var(--theme-primary)]/10 border-l-2 border-[var(--theme-primary)]' : 'hover:bg-[var(--theme-bg-secondary)]'
                ]"
                @click="executeAction(action)"
              >
                <span class="text-xl">{{ action.icon }}</span>
                <span class="flex-1 text-sm text-[var(--theme-text-primary)]">{{ action.label }}</span>
              </button>
            </div>

            <!-- Action category -->
            <div v-if="groupedActions.action.length > 0" class="py-2">
              <div class="px-4 py-2">
                <h3 class="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-tertiary)]">
                  Actions
                </h3>
              </div>
              <button
                v-for="action in groupedActions.action"
                :key="action.id"
                :class="[
                  'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                  isSelected(action) ? 'bg-[var(--theme-primary)]/10 border-l-2 border-[var(--theme-primary)]' : 'hover:bg-[var(--theme-bg-secondary)]'
                ]"
                @click="executeAction(action)"
              >
                <span class="text-xl">{{ action.icon }}</span>
                <span class="flex-1 text-sm text-[var(--theme-text-primary)]">{{ action.label }}</span>
              </button>
            </div>

            <!-- Settings category -->
            <div v-if="groupedActions.settings.length > 0" class="py-2">
              <div class="px-4 py-2">
                <h3 class="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-tertiary)]">
                  Settings
                </h3>
              </div>
              <button
                v-for="action in groupedActions.settings"
                :key="action.id"
                :class="[
                  'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                  isSelected(action) ? 'bg-[var(--theme-primary)]/10 border-l-2 border-[var(--theme-primary)]' : 'hover:bg-[var(--theme-bg-secondary)]'
                ]"
                @click="executeAction(action)"
              >
                <span class="text-xl">{{ action.icon }}</span>
                <span class="flex-1 text-sm text-[var(--theme-text-primary)]">{{ action.label }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Footer hint -->
        <div class="px-4 py-3 border-t border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)]">
          <div class="flex items-center justify-between text-xs text-[var(--theme-text-tertiary)]">
            <div class="flex items-center gap-4">
              <span>↑↓ Navigate</span>
              <span>↵ Select</span>
              <span>Esc Close</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useCommandPalette } from '../composables/useCommandPalette';
import type { CommandAction } from '../composables/useCommandPalette';

const {
  isOpen,
  searchQuery,
  selectedIndex,
  filteredActions,
  groupedActions,
  close,
  moveSelectionUp,
  moveSelectionDown,
  executeSelectedAction
} = useCommandPalette();

const searchInputRef = ref<HTMLInputElement | null>(null);

// Auto-focus search input when opened
watch(isOpen, (newValue) => {
  if (newValue) {
    nextTick(() => {
      searchInputRef.value?.focus();
    });
  }
});

// Check if an action is currently selected
const isSelected = (action: CommandAction): boolean => {
  const index = filteredActions.value.findIndex(a => a.id === action.id);
  return index === selectedIndex.value;
};

// Execute an action when clicked
const executeAction = (action: CommandAction) => {
  action.execute();
  close();
};

// Reset selected index when search query changes
watch(searchQuery, () => {
  selectedIndex.value = 0;
});
</script>
