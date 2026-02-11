<template>
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
    <!-- No projects state -->
    <div v-if="projects.length === 0" class="col-span-full flex flex-col items-center justify-center py-16 text-[var(--theme-text-tertiary)]">
      <span class="text-4xl mb-3">📡</span>
      <p class="text-lg font-medium">No projects detected yet</p>
      <p class="text-sm mt-1">Start a Claude Code session with DevPulse hooks installed</p>
    </div>

    <!-- Project cards -->
    <div
      v-for="project in projects"
      :key="project.name"
      class="bg-[var(--theme-bg-primary)] rounded-xl border border-[var(--theme-border-primary)] shadow-sm hover:shadow-md transition-shadow transition-opacity duration-300 overflow-hidden"
      :class="{ 'opacity-75': project.active_sessions === 0 }"
    >
      <!-- Card header -->
      <div class="px-4 py-3 border-b border-[var(--theme-border-secondary)] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-lg">📁</span>
          <h3 class="text-base font-semibold text-[var(--theme-text-primary)]">{{ project.name }}</h3>
        </div>
        <div class="flex items-center gap-3">
          <!-- Health Ring (E5-S4) -->
          <div
            v-if="project.health"
            class="relative group cursor-help"
            :title="healthTooltip(project)"
          >
            <HealthRing
              :score="project.health.score"
              :trend="project.health.trend"
              :size="40"
              class="md:block hidden"
            />
            <HealthRing
              :score="project.health.score"
              :trend="project.health.trend"
              :size="32"
              class="md:hidden"
            />
            <!-- Tooltip on hover -->
            <div class="absolute hidden group-hover:block z-10 w-56 p-3 rounded-lg shadow-lg bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] left-1/2 -translate-x-1/2 bottom-full mb-2 pointer-events-none">
              <div class="text-xs space-y-1.5">
                <div class="font-semibold text-[var(--theme-text-primary)] pb-1 border-b border-[var(--theme-border-secondary)]">
                  Health Score Breakdown
                </div>
                <div class="flex justify-between text-[var(--theme-text-secondary)]">
                  <span>Test Status (40%):</span>
                  <span class="font-medium">{{ project.health.testScore }}</span>
                </div>
                <div class="flex justify-between text-[var(--theme-text-secondary)]">
                  <span>Activity (30%):</span>
                  <span class="font-medium">{{ project.health.activityScore }}</span>
                </div>
                <div class="flex justify-between text-[var(--theme-text-secondary)]">
                  <span>Error Rate (30%):</span>
                  <span class="font-medium">{{ project.health.errorRateScore }}</span>
                </div>
                <div class="flex justify-between text-[var(--theme-text-primary)] font-semibold pt-1 border-t border-[var(--theme-border-secondary)]">
                  <span>Overall:</span>
                  <span>{{ project.health.score }}</span>
                </div>
              </div>
              <!-- Tooltip arrow -->
              <div class="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-[var(--theme-border-primary)]"></div>
            </div>
          </div>

          <!-- Active sessions badge -->
          <span
            v-if="project.active_sessions > 0"
            class="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
            :class="project.active_sessions > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
          >
            <span class="relative flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            {{ project.active_sessions }} active
          </span>
          <span v-else class="text-xs text-[var(--theme-text-quaternary)] px-2 py-0.5 rounded-full bg-[var(--theme-bg-tertiary)]">
            idle
          </span>
        </div>
      </div>

      <!-- Card body -->
      <div class="px-4 py-3 space-y-3">
        <!-- Branch -->
        <div class="flex items-center gap-2 text-sm">
          <span class="text-[var(--theme-text-tertiary)]">🌿</span>
          <code class="text-xs font-mono bg-[var(--theme-bg-tertiary)] px-2 py-0.5 rounded text-[var(--theme-text-secondary)]">
            {{ project.current_branch || 'main' }}
          </code>
        </div>

        <!-- Test status -->
        <div class="flex items-center gap-2 text-sm">
          <span>{{ testIcon(project.test_status) }}</span>
          <span
            class="text-xs font-medium"
            :class="testClass(project.test_status)"
          >
            {{ project.test_summary || project.test_status || 'No tests run' }}
          </span>
        </div>

        <!-- Dev servers -->
        <div v-if="parsedServers(project).length > 0" class="flex items-center gap-2 text-sm">
          <span>🖥️</span>
          <div class="flex flex-wrap gap-1">
            <a
              v-for="server in parsedServers(project)"
              :key="server.port"
              :href="'http://localhost:' + server.port"
              target="_blank"
              class="text-xs font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            >
              :{{ server.port }} ({{ server.type }})
            </a>
          </div>
        </div>

        <!-- Deployment status -->
        <div v-if="parsedDeployment(project)" class="flex items-center gap-2 text-sm">
          <span>🚀</span>
          <a
            :href="'https://' + parsedDeployment(project)!.url"
            target="_blank"
            class="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded transition-colors"
            :class="deploymentBadgeClass(parsedDeployment(project)!.state)"
          >
            <span
              class="w-2 h-2 rounded-full"
              :class="deploymentDotClass(parsedDeployment(project)!.state)"
            ></span>
            <span>{{ deploymentStateText(parsedDeployment(project)!.state) }}</span>
            <span class="text-[var(--theme-text-quaternary)]">{{ deploymentTimeAgo(parsedDeployment(project)!.created) }}</span>
          </a>
        </div>
        <div v-if="parsedDeployment(project) && parsedDeployment(project)!.commit_message" class="text-xs text-[var(--theme-text-tertiary)] pl-6 -mt-1">
          {{ parsedDeployment(project)!.commit_message }}
        </div>

        <!-- Sessions list -->
        <div v-if="projectSessions(project.name).length > 0" class="mt-2">
          <div class="text-xs text-[var(--theme-text-tertiary)] mb-1.5 font-medium uppercase tracking-wide">Sessions</div>
          <div class="space-y-1">
            <div
              v-for="session in projectSessions(project.name)"
              :key="session.session_id"
              class="bg-[var(--theme-bg-tertiary)] rounded px-2 py-1.5 transition-opacity duration-300 space-y-1"
              :class="{
                'opacity-50': session.status === 'idle' || session.status === 'stopped',
                'ring-2 ring-red-400 ring-opacity-50': getCompactionHealth(session) === 'red'
              }"
            >
              <div class="flex items-center justify-between text-xs">
                <div class="flex items-center gap-1.5">
                  <span
                    class="w-2 h-2 rounded-full transition-colors duration-300"
                    :class="{
                      'bg-green-500': session.status === 'active',
                      'bg-yellow-500': session.status === 'waiting',
                      'bg-gray-400': session.status === 'idle',
                      'bg-red-400': session.status === 'stopped'
                    }"
                  ></span>
                  <span class="font-mono text-[var(--theme-text-secondary)]">
                    {{ session.session_id.slice(0, 8) }}
                  </span>
                  <!-- Context health indicator (E4-S3) -->
                  <span
                    v-if="session.compaction_count > 0"
                    :title="compactionTooltip(session)"
                    class="w-2 h-2 rounded-full cursor-help transition-colors duration-300"
                    :class="{
                      'bg-green-500': getCompactionHealth(session) === 'green',
                      'bg-yellow-500': getCompactionHealth(session) === 'yellow',
                      'bg-red-500 animate-pulse': getCompactionHealth(session) === 'red'
                    }"
                  ></span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-[var(--theme-text-quaternary)]">
                    {{ session.model_name ? session.model_name.split('-').slice(0, 2).join('-') : '' }}
                  </span>
                  <span class="text-[var(--theme-text-quaternary)]">
                    {{ timeAgo(session.last_event_at) }}
                  </span>
                </div>
              </div>
              <!-- Task context badge -->
              <div v-if="parseTaskContext(session).display" class="flex items-center gap-1.5 text-xs">
                <span
                  class="px-2 py-0.5 rounded font-medium"
                  :class="taskBadgeClass(parseTaskContext(session).prefix)"
                >
                  {{ parseTaskContext(session).display }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Last activity -->
        <div class="text-xs text-[var(--theme-text-quaternary)] pt-1 border-t border-[var(--theme-border-secondary)]">
          Last activity: {{ timeAgo(project.last_activity) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Project, Session } from '../types';
import HealthRing from './HealthRing.vue';

const props = defineProps<{
  projects: Project[];
  sessions: Session[];
}>();

function parsedServers(project: Project): Array<{port: number; type: string}> {
  try {
    return JSON.parse(project.dev_servers || '[]');
  } catch {
    return [];
  }
}

function projectSessions(projectName: string): Session[] {
  return props.sessions.filter(s => s.project_name === projectName);
}

function testIcon(status: string): string {
  switch (status) {
    case 'passing': return '✅';
    case 'failing': return '❌';
    default: return '⏸️';
  }
}

function testClass(status: string): string {
  switch (status) {
    case 'passing': return 'text-green-600';
    case 'failing': return 'text-red-600';
    default: return 'text-[var(--theme-text-tertiary)]';
  }
}

function timeAgo(timestamp: number): string {
  if (!timestamp) return 'never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface DeploymentStatus {
  state: string;
  url: string;
  commit_message: string;
  created: number;
  vercel_project_id: string;
}

function parsedDeployment(project: Project): DeploymentStatus | null {
  if (!project.deployment_status) return null;
  try {
    return JSON.parse(project.deployment_status);
  } catch {
    return null;
  }
}

function deploymentStateText(state: string): string {
  switch (state) {
    case 'BUILDING': return 'Building';
    case 'READY': return 'Ready';
    case 'ERROR': return 'Error';
    case 'QUEUED': return 'Queued';
    case 'CANCELED': return 'Canceled';
    default: return state;
  }
}

function deploymentBadgeClass(state: string): string {
  switch (state) {
    case 'READY':
      return 'bg-green-50 text-green-700 hover:bg-green-100';
    case 'BUILDING':
      return 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 animate-pulse';
    case 'ERROR':
      return 'bg-red-50 text-red-700 hover:bg-red-100';
    case 'QUEUED':
      return 'bg-gray-100 text-gray-600 hover:bg-gray-200';
    case 'CANCELED':
      return 'bg-gray-100 text-gray-500 hover:bg-gray-200';
    default:
      return 'bg-gray-100 text-gray-600 hover:bg-gray-200';
  }
}

function deploymentDotClass(state: string): string {
  switch (state) {
    case 'READY':
      return 'bg-green-500';
    case 'BUILDING':
      return 'bg-yellow-500 animate-pulse';
    case 'ERROR':
      return 'bg-red-500';
    case 'QUEUED':
      return 'bg-gray-400';
    case 'CANCELED':
      return 'bg-gray-400';
    default:
      return 'bg-gray-400';
  }
}

function deploymentTimeAgo(created: number): string {
  if (!created) return '';
  const now = Date.now();
  const seconds = Math.floor((now - created) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface TaskContext {
  prefix: string;
  ticket_id: string;
  description: string;
  display: string;
}

function parseTaskContext(session: Session): TaskContext {
  // Default empty context if no task_context field
  const defaultContext: TaskContext = {
    prefix: '',
    ticket_id: '',
    description: session.current_branch || '',
    display: ''
  };

  if (!session.task_context) {
    return defaultContext;
  }

  try {
    const parsed = JSON.parse(session.task_context);
    return parsed as TaskContext;
  } catch {
    return defaultContext;
  }
}

function taskBadgeClass(prefix: string): string {
  switch (prefix) {
    case 'feature':
      return 'bg-green-50 text-green-700';
    case 'fix':
    case 'bugfix':
      return 'bg-orange-50 text-orange-700';
    case 'hotfix':
      return 'bg-red-50 text-red-700';
    case 'chore':
      return 'bg-blue-50 text-blue-700';
    case 'refactor':
      return 'bg-purple-50 text-purple-700';
    case 'release':
      return 'bg-indigo-50 text-indigo-700';
    case 'docs':
      return 'bg-cyan-50 text-cyan-700';
    case 'test':
      return 'bg-teal-50 text-teal-700';
    default:
      return 'bg-gray-50 text-gray-700';
  }
}

// --- Context Window Health Functions (E4-S3) ---

type CompactionHealth = 'green' | 'yellow' | 'red';

function getCompactionHealth(session: Session): CompactionHealth {
  if (!session.compaction_history) return 'green';

  const tenMinutesAgo = Date.now() - 600000;
  let history: number[] = [];

  try {
    history = JSON.parse(session.compaction_history);
  } catch {
    return 'green';
  }

  const recentCompactions = history.filter(ts => ts > tenMinutesAgo).length;

  if (recentCompactions >= 3) return 'red';
  if (recentCompactions >= 1) return 'yellow';
  return 'green';
}

function compactionTooltip(session: Session): string {
  const count = session.compaction_count || 0;
  const lastAt = session.last_compaction_at;

  if (count === 0) return 'No compactions yet';

  const parts: string[] = [`Total: ${count} compaction${count !== 1 ? 's' : ''}`];

  if (lastAt) {
    const timeSince = timeAgo(lastAt);
    parts.push(`Last: ${timeSince}`);
  }

  // Calculate frequency (compactions per hour)
  const sessionDuration = Date.now() - session.started_at;
  const hoursRunning = sessionDuration / (1000 * 60 * 60);
  if (hoursRunning > 0) {
    const frequency = count / hoursRunning;
    parts.push(`Frequency: ${frequency.toFixed(1)}/hr`);
  }

  return parts.join(' | ');
}

// --- Health Score Functions (E5-S4) ---

function healthTooltip(project: Project): string {
  if (!project.health) return 'Health data unavailable';

  return `Health: ${project.health.score}/100 | Test: ${project.health.testScore} | Activity: ${project.health.activityScore} | Errors: ${project.health.errorRateScore}`;
}
</script>
