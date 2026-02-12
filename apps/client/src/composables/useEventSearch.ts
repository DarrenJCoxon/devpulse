import { ref, computed, watch } from 'vue';
import type { HookEvent } from '../types';

// Saved Filter Interface
export interface SavedFilter {
  id: string;              // UUID
  name: string;            // User-provided name
  query: string;           // Search text
  sourceApp: string;       // Filter value
  sessionId: string;       // Filter value
  eventType: string;       // Filter value
  createdAt: number;
}

const STORAGE_KEY = 'devpulse-saved-filters';

// Generate a simple UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function useEventSearch() {
  const searchPattern = ref<string>('');
  const searchError = ref<string>('');
  const savedFilters = ref<SavedFilter[]>([]);

  // Load saved filters from localStorage on init
  const loadSavedFilters = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        savedFilters.value = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load saved filters:', error);
      savedFilters.value = [];
    }
  };

  // Save filters to localStorage
  const persistFilters = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedFilters.value));
    } catch (error) {
      console.error('Failed to persist filters:', error);
    }
  };

  // Watch for changes and persist
  watch(savedFilters, persistFilters, { deep: true });

  // Initialize
  loadSavedFilters();

  // Save a new filter
  const saveFilter = (name: string, filters: { query: string; sourceApp: string; sessionId: string; eventType: string }) => {
    const newFilter: SavedFilter = {
      id: generateUUID(),
      name: name.trim(),
      query: filters.query,
      sourceApp: filters.sourceApp,
      sessionId: filters.sessionId,
      eventType: filters.eventType,
      createdAt: Date.now()
    };

    savedFilters.value.push(newFilter);
    return newFilter;
  };

  // Delete a filter
  const deleteFilter = (id: string) => {
    const index = savedFilters.value.findIndex(f => f.id === id);
    if (index !== -1) {
      savedFilters.value.splice(index, 1);
    }
  };

  // Load a filter (returns the filter object)
  const loadFilter = (id: string): SavedFilter | undefined => {
    return savedFilters.value.find(f => f.id === id);
  };

  // Rename a filter
  const renameFilter = (id: string, newName: string) => {
    const filter = savedFilters.value.find(f => f.id === id);
    if (filter) {
      filter.name = newName.trim();
    }
  };

  // Validate regex pattern
  const validateRegex = (pattern: string): { valid: boolean; error?: string } => {
    if (!pattern || pattern.trim() === '') {
      return { valid: true };
    }

    try {
      new RegExp(pattern);
      return { valid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid regex pattern';
      return { valid: false, error: errorMessage };
    }
  };

  // Extract searchable text from event
  const getSearchableText = (event: HookEvent): string => {
    const parts: string[] = [];

    // Event type
    if (event.hook_event_type) {
      parts.push(event.hook_event_type);
    }

    // Source app and session
    if (event.source_app) {
      parts.push(event.source_app);
    }
    if (event.session_id) {
      parts.push(event.session_id);
    }

    // Model name
    if (event.model_name) {
      parts.push(event.model_name);
    }

    // Tool information (from payload)
    if (event.payload?.tool_name) {
      parts.push(event.payload.tool_name);
    }
    if (event.payload?.command) {
      parts.push(event.payload.command);
    }
    if (event.payload?.file_path) {
      parts.push(event.payload.file_path);
    }

    // Summary text
    if (event.summary) {
      parts.push(event.summary);
    }

    // HITL information
    if (event.humanInTheLoop?.question) {
      parts.push(event.humanInTheLoop.question);
    }

    return parts.join(' ').toLowerCase();
  };

  // Check if event matches pattern
  const matchesPattern = (event: HookEvent, pattern: string): boolean => {
    if (!pattern || pattern.trim() === '') {
      return true;
    }

    const validation = validateRegex(pattern);
    if (!validation.valid) {
      return false;
    }

    try {
      const regex = new RegExp(pattern, 'i'); // Case-insensitive
      const searchableText = getSearchableText(event);
      return regex.test(searchableText);
    } catch {
      return false;
    }
  };

  // Filter events by pattern
  const searchEvents = (events: HookEvent[], pattern: string): HookEvent[] => {
    if (!pattern || pattern.trim() === '') {
      return events;
    }

    return events.filter(event => matchesPattern(event, pattern));
  };

  // Computed property for current error
  const hasError = computed(() => searchError.value.length > 0);

  // Update search pattern and validate
  const updateSearchPattern = (pattern: string) => {
    searchPattern.value = pattern;

    if (!pattern || pattern.trim() === '') {
      searchError.value = '';
      return;
    }

    const validation = validateRegex(pattern);
    if (!validation.valid) {
      searchError.value = validation.error || 'Invalid regex pattern';
    } else {
      searchError.value = '';
    }
  };

  // Clear search
  const clearSearch = () => {
    searchPattern.value = '';
    searchError.value = '';
  };

  return {
    searchPattern,
    searchError,
    hasError,
    validateRegex,
    matchesPattern,
    searchEvents,
    updateSearchPattern,
    clearSearch,
    getSearchableText,
    // Saved filters
    savedFilters,
    saveFilter,
    deleteFilter,
    loadFilter,
    renameFilter
  };
}
