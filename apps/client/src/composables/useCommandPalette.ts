import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { Project } from '../types';
import { API_BASE_URL } from '../config';

export interface CommandAction {
  id: string;
  label: string;
  category: 'navigate' | 'filter' | 'action' | 'settings';
  keywords: string[];
  icon: string;
  execute: () => void;
}

interface FilterOptions {
  source_apps: string[];
  session_ids: string[];
  hook_event_types: string[];
}

// Global state for the command palette
const isOpen = ref(false);
const searchQuery = ref('');
const selectedIndex = ref(0);
const actions = ref<CommandAction[]>([]);

// Global callbacks for filter updates
let filterUpdateCallbacks: {
  updateSessionFilter?: (sessionId: string) => void;
  updateSourceFilter?: (sourceApp: string) => void;
  updateTypeFilter?: (eventType: string) => void;
  navigateToProject?: (projectName: string) => void;
} = {};

export function useCommandPalette() {
  // Fuzzy search scoring function
  const fuzzyScore = (query: string, target: string): number => {
    if (!query) return 0;

    const lowerQuery = query.toLowerCase();
    const lowerTarget = target.toLowerCase();

    // Exact match - highest score
    if (lowerTarget === lowerQuery) return 1000;

    // Prefix match - high score
    if (lowerTarget.startsWith(lowerQuery)) return 500;

    // Substring match - medium score
    if (lowerTarget.includes(lowerQuery)) return 250;

    // Character-by-character fuzzy match - lower score
    let queryIndex = 0;
    let targetIndex = 0;
    let score = 0;
    let consecutiveMatches = 0;

    while (queryIndex < lowerQuery.length && targetIndex < lowerTarget.length) {
      if (lowerQuery[queryIndex] === lowerTarget[targetIndex]) {
        queryIndex++;
        consecutiveMatches++;
        score += 10 + consecutiveMatches * 5; // Bonus for consecutive matches
      } else {
        consecutiveMatches = 0;
      }
      targetIndex++;
    }

    // If we matched all query characters, return the score, else 0
    return queryIndex === lowerQuery.length ? score : 0;
  };

  // Search actions based on query
  const filteredActions = computed(() => {
    if (!searchQuery.value.trim()) {
      return actions.value;
    }

    const query = searchQuery.value.trim();

    // Score each action
    const scoredActions = actions.value.map(action => {
      const labelScore = fuzzyScore(query, action.label);
      const keywordScore = Math.max(...action.keywords.map(k => fuzzyScore(query, k)), 0);
      const maxScore = Math.max(labelScore, keywordScore);

      return {
        action,
        score: maxScore
      };
    });

    // Filter actions with score > 0 and sort by score descending
    return scoredActions
      .filter(sa => sa.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(sa => sa.action);
  });

  // Group filtered actions by category
  const groupedActions = computed(() => {
    const groups: Record<string, CommandAction[]> = {
      navigate: [],
      filter: [],
      action: [],
      settings: []
    };

    filteredActions.value.forEach(action => {
      groups[action.category].push(action);
    });

    return groups;
  });

  // Open the palette
  const open = async () => {
    isOpen.value = true;
    searchQuery.value = '';
    selectedIndex.value = 0;

    // Load dynamic actions
    await loadDynamicActions();
  };

  // Close the palette
  const close = () => {
    isOpen.value = false;
    searchQuery.value = '';
    selectedIndex.value = 0;
  };

  // Execute the selected action
  const executeSelectedAction = () => {
    const action = filteredActions.value[selectedIndex.value];
    if (action) {
      action.execute();
      close();
    }
  };

  // Navigate selection with arrow keys
  const moveSelectionUp = () => {
    if (selectedIndex.value > 0) {
      selectedIndex.value--;
    }
  };

  const moveSelectionDown = () => {
    if (selectedIndex.value < filteredActions.value.length - 1) {
      selectedIndex.value++;
    }
  };

  // Load dynamic actions from API
  const loadDynamicActions = async () => {
    try {
      // Fetch projects
      const projectsResponse = await fetch(`${API_BASE_URL}/api/projects`);
      const projects: Project[] = await projectsResponse.json();

      // Fetch filter options
      const filterOptionsResponse = await fetch(`${API_BASE_URL}/events/filter-options`);
      const filterOptions: FilterOptions = await filterOptionsResponse.json();

      // Get static actions (preserve them)
      const staticActions = actions.value.filter(a =>
        !a.id.startsWith('project-') &&
        !a.id.startsWith('filter-session-') &&
        !a.id.startsWith('filter-source-') &&
        !a.id.startsWith('filter-type-')
      );

      // Generate project navigation actions
      const projectActions: CommandAction[] = projects.map(project => ({
        id: `project-${project.name}`,
        label: `Jump to ${project.name}`,
        category: 'navigate' as const,
        keywords: ['project', project.name.toLowerCase(), 'jump', 'navigate'],
        icon: '📁',
        execute: () => {
          if (filterUpdateCallbacks.navigateToProject) {
            filterUpdateCallbacks.navigateToProject(project.name);
          }
        }
      }));

      // Generate session filter actions
      const sessionFilterActions: CommandAction[] = filterOptions.session_ids.map(sessionId => ({
        id: `filter-session-${sessionId}`,
        label: `Filter by session ${sessionId.substring(0, 8)}`,
        category: 'filter' as const,
        keywords: ['filter', 'session', sessionId],
        icon: '🔍',
        execute: () => {
          if (filterUpdateCallbacks.updateSessionFilter) {
            filterUpdateCallbacks.updateSessionFilter(sessionId);
          }
        }
      }));

      // Generate source app filter actions
      const sourceFilterActions: CommandAction[] = filterOptions.source_apps.map(sourceApp => ({
        id: `filter-source-${sourceApp}`,
        label: `Filter by source ${sourceApp}`,
        category: 'filter' as const,
        keywords: ['filter', 'source', sourceApp],
        icon: '🔍',
        execute: () => {
          if (filterUpdateCallbacks.updateSourceFilter) {
            filterUpdateCallbacks.updateSourceFilter(sourceApp);
          }
        }
      }));

      // Generate event type filter actions
      const typeFilterActions: CommandAction[] = filterOptions.hook_event_types.map(eventType => ({
        id: `filter-type-${eventType}`,
        label: `Filter by type ${eventType}`,
        category: 'filter' as const,
        keywords: ['filter', 'type', eventType],
        icon: '🔍',
        execute: () => {
          if (filterUpdateCallbacks.updateTypeFilter) {
            filterUpdateCallbacks.updateTypeFilter(eventType);
          }
        }
      }));

      // Combine all actions
      actions.value = [
        ...staticActions,
        ...projectActions,
        ...sessionFilterActions,
        ...sourceFilterActions,
        ...typeFilterActions
      ];
    } catch (error) {
      console.error('Failed to load dynamic actions:', error);
      // Keep only static actions on error
      const staticActions = actions.value.filter(a =>
        !a.id.startsWith('project-') &&
        !a.id.startsWith('filter-session-') &&
        !a.id.startsWith('filter-source-') &&
        !a.id.startsWith('filter-type-')
      );
      actions.value = staticActions;
    }
  };

  // Register a static action
  const registerAction = (action: CommandAction) => {
    // Check if action already exists
    const existingIndex = actions.value.findIndex(a => a.id === action.id);
    if (existingIndex >= 0) {
      // Update existing action
      actions.value[existingIndex] = action;
    } else {
      // Add new action
      actions.value.push(action);
    }
  };

  // Set filter update callbacks
  const setFilterCallbacks = (callbacks: typeof filterUpdateCallbacks) => {
    filterUpdateCallbacks = { ...filterUpdateCallbacks, ...callbacks };
  };

  // Global keyboard listener
  const handleGlobalKeydown = (event: KeyboardEvent) => {
    // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      if (isOpen.value) {
        close();
      } else {
        open();
      }
      return;
    }

    // Only handle these keys when palette is open
    if (!isOpen.value) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveSelectionDown();
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveSelectionUp();
        break;
      case 'Enter':
        event.preventDefault();
        executeSelectedAction();
        break;
    }
  };

  // Setup and cleanup
  onMounted(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
  });

  return {
    isOpen,
    searchQuery,
    selectedIndex,
    filteredActions,
    groupedActions,
    open,
    close,
    registerAction,
    setFilterCallbacks,
    moveSelectionUp,
    moveSelectionDown,
    executeSelectedAction
  };
}
