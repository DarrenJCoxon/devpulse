import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import type { Project, Session, DevLog } from '../types';
import { API_BASE_URL } from '../config';

export function useProjects(projects: Ref<Project[]>, sessions: Ref<Session[]>) {
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

  onMounted(() => {
    fetchDevLogs();
    pollInterval = window.setInterval(fetchDevLogs, 30000);
  });

  onUnmounted(() => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });

  return { projects, sessions, devLogs };
}
