import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import type { Project, Session, DevLog } from '../types';
import { API_BASE_URL } from '../config';

export function useProjects(projects: Ref<Project[]>, sessions: Ref<Session[]>, wsDevLogs?: Ref<DevLog[]>) {
  const devLogs = ref<DevLog[]>([]);
  let pollInterval: number | null = null;

  async function fetchDevLogs() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/devlogs?limit=50`);
      if (response.ok) {
        devLogs.value = await response.json();
      }
    } catch (err) {
      console.error('Failed to fetch dev logs:', err);
    }
  }

  // If WebSocket dev logs are provided, use them when they update
  if (wsDevLogs) {
    watch(wsDevLogs, (newLogs) => {
      if (newLogs.length > 0) {
        devLogs.value = newLogs;
      }
    });
  }

  onMounted(() => {
    // Initial fetch (WebSocket won't have data until a session ends)
    fetchDevLogs();
    // Poll less frequently since WebSocket handles real-time updates
    pollInterval = window.setInterval(fetchDevLogs, 60000);
  });

  onUnmounted(() => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });

  return { projects, sessions, devLogs };
}
