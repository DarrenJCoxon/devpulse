<template>
  <div class="flex flex-col h-full">
    <!-- Empty state -->
    <div
      v-if="visibleProjects.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-muted-foreground px-6"
    >
      <Activity class="w-10 h-10 mb-4 opacity-40" />
      <p class="text-lg font-medium">No projects detected yet.</p>
      <p class="text-sm mt-1">
        Start a Claude Code session with hooks installed.
      </p>
      <button
        v-if="hiddenProjects.size > 0"
        @click="hiddenProjects.clear(); saveHiddenProjects()"
        class="mt-4 text-sm text-primary hover:underline"
      >
        Show {{ hiddenProjects.size }} hidden project{{ hiddenProjects.size > 1 ? 's' : '' }}
      </button>
    </div>

    <template v-else>
      <!-- Project tabs -->
      <div class="border-b border-border px-6">
        <div class="max-w-6xl mx-auto w-full flex items-center gap-1.5 pt-3 -mb-px overflow-x-auto">
          <button
            v-for="project in visibleProjects"
            :key="project.name"
            @click="selectProject(project.name)"
            class="group relative flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border transition-colors shrink-0"
            :class="activeProject === project.name
              ? 'border-border border-b-background bg-background text-foreground shadow-sm'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'"
            role="tab"
            :aria-selected="activeProject === project.name"
          >
            <!-- Status dot (colored by project status) -->
            <span class="relative flex h-2 w-2 shrink-0">
              <span
                v-if="projectStatus(project.name) === 'active' || projectStatus(project.name) === 'starting'"
                class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                :style="{ backgroundColor: statusColor(project.name) }"
              />
              <span
                class="relative inline-flex h-2 w-2 rounded-full"
                :style="{ backgroundColor: statusColor(project.name) }"
              />
            </span>
            {{ project.name }}
            <!-- Session count -->
            <span v-if="liveSessions(project.name).length > 0" class="text-xs text-muted-foreground ml-0.5">
              ({{ liveSessions(project.name).length }})
            </span>
            <!-- Alert indicator: shows when status changed since last viewed -->
            <span
              v-if="hasAlert(project.name)"
              class="absolute -top-1 -right-1 flex h-3 w-3"
            >
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span class="relative inline-flex h-3 w-3 rounded-full bg-orange-500" />
            </span>
            <!-- Hide button -->
            <span
              @click.stop="hideProject(project.name)"
              class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
              title="Hide this project"
            >
              <EyeOff class="w-3 h-3" />
            </span>
          </button>
          <!-- Restore hidden projects -->
          <button
            v-if="hiddenProjects.size > 0"
            @click="hiddenProjects.clear(); saveHiddenProjects()"
            class="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 px-2 py-1"
          >
            +{{ hiddenProjects.size }} hidden
          </button>
        </div>
      </div>

      <!-- Active project content -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="activeProjectData" class="max-w-6xl mx-auto w-full px-6 py-6">
          <Card class="transition-shadow hover:shadow-md">
            <!-- Header: project name + overall status -->
            <CardHeader class="pb-3">
              <div class="flex items-center gap-2.5">
                <span class="relative flex h-2.5 w-2.5 shrink-0">
                  <span
                    v-if="projectStatus(activeProjectData.name) === 'active' || projectStatus(activeProjectData.name) === 'starting'"
                    class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    :style="{ backgroundColor: statusColor(activeProjectData.name) }"
                  />
                  <span
                    class="relative inline-flex h-2.5 w-2.5 rounded-full"
                    :style="{ backgroundColor: statusColor(activeProjectData.name) }"
                  />
                </span>
                <CardTitle class="text-lg font-semibold">
                  {{ activeProjectData.name }}
                </CardTitle>
                <span
                  class="text-xs font-medium px-1.5 py-0.5 rounded-full"
                  :class="statusBadgeClass(activeProjectData.name)"
                >
                  {{ statusLabel(activeProjectData.name) }}
                </span>
              </div>
            </CardHeader>

            <CardContent class="space-y-4 pt-0">
              <!-- New branch detected but no session events yet -->
              <div
                v-if="projectStatus(activeProjectData.name) === 'starting'"
                class="rounded-lg border border-blue-500/30 bg-blue-500/5 overflow-hidden"
              >
                <div class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span class="relative flex h-2 w-2 shrink-0">
                      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
                      <span class="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                    </span>
                    <span class="text-sm font-semibold text-foreground">
                      {{ humanizeBranch(activeProjectData.current_branch) }}
                    </span>
                    <span class="ml-auto text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
                      Starting
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5 mt-1 pl-4">
                    <GitBranch class="w-3 h-3 text-muted-foreground shrink-0" />
                    <span class="text-xs text-muted-foreground font-mono truncate">
                      {{ activeProjectData.current_branch }}
                    </span>
                  </div>
                  <p class="text-xs text-muted-foreground mt-2 pl-4">
                    New branch detected — waiting for session events
                  </p>
                </div>
              </div>

              <!-- All session panels (live + recently stopped) -->
              <div
                v-for="session in allProjectSessions(activeProjectData.name)"
                :key="session.session_id"
                class="rounded-lg border overflow-hidden"
                :class="session.status === 'stopped' ? 'bg-muted/20 opacity-70' : 'bg-muted/30'"
              >
                <!-- Session header: task name + status -->
                <div class="px-4 py-3 border-b border-border/50">
                  <div class="flex items-center gap-2">
                    <!-- Status dot -->
                    <span class="relative flex h-2 w-2 shrink-0">
                      <span
                        v-if="session.status === 'active'"
                        class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"
                      />
                      <span
                        class="relative inline-flex h-2 w-2 rounded-full"
                        :class="{
                          'bg-emerald-500': session.status === 'active',
                          'bg-amber-500': session.status === 'idle' || session.status === 'waiting',
                          'bg-muted-foreground/50': session.status === 'stopped',
                        }"
                      />
                    </span>
                    <!-- Task/story name (from task_context or branch) -->
                    <span class="text-sm font-semibold truncate" :class="session.status === 'stopped' ? 'text-muted-foreground' : 'text-foreground'">
                      {{ sessionTaskName(session) }}
                    </span>
                    <!-- Status badge -->
                    <span
                      class="ml-auto text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0"
                      :class="{
                        'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400': session.status === 'active',
                        'bg-amber-500/15 text-amber-600 dark:text-amber-400': session.status === 'idle' || session.status === 'waiting',
                        'bg-muted text-muted-foreground': session.status === 'stopped',
                      }"
                    >
                      {{ sessionStatusLabel(session) }}
                    </span>
                  </div>
                  <!-- Branch name (small, under the task name) -->
                  <div class="flex items-center gap-1.5 mt-1 pl-4">
                    <GitBranch class="w-3 h-3 text-muted-foreground shrink-0" />
                    <span class="text-xs text-muted-foreground font-mono truncate">
                      {{ session.current_branch }}
                    </span>
                  </div>
                </div>

                <!-- Recent activity timeline (last 3-4 events) -->
                <div class="px-4 py-2.5 space-y-1.5">
                  <div
                    v-for="(activity, idx) in recentSessionActivities(session, session.status === 'stopped' ? 2 : 4)"
                    :key="idx"
                    class="flex items-start gap-2 text-xs"
                  >
                    <span class="text-muted-foreground shrink-0 w-16 text-right tabular-nums">
                      {{ liveTimeAgo(activity.timestamp) }}
                    </span>
                    <span class="w-px h-3 bg-border shrink-0 mt-0.5" />
                    <span class="truncate" :class="session.status === 'stopped' ? 'text-muted-foreground' : 'text-foreground'">
                      {{ activity.description }}
                    </span>
                  </div>
                  <!-- Dev log summary for stopped sessions -->
                  <p
                    v-if="session.status === 'stopped' && sessionDevLogSummary(session)"
                    class="text-xs text-muted-foreground italic"
                  >
                    {{ sessionDevLogSummary(session) }}
                  </p>
                  <p
                    v-if="recentSessionActivities(session, 2).length === 0 && !sessionDevLogSummary(session)"
                    class="text-xs text-muted-foreground italic"
                  >
                    No recent activity
                  </p>
                </div>

                <!-- Session footer: duration + event count -->
                <div class="px-4 py-2 border-t border-border/50 flex items-center gap-3 text-xs text-muted-foreground">
                  <span class="flex items-center gap-1">
                    <Clock class="w-3 h-3" />
                    {{ sessionDuration(session) }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Zap class="w-3 h-3" />
                    {{ session.event_count }} event{{ session.event_count !== 1 ? 's' : '' }}
                  </span>
                  <span v-if="session.status === 'stopped' && session.last_event_at" class="ml-auto">
                    Finished {{ liveTimeAgo(session.last_event_at) }}
                  </span>
                </div>
              </div>

              <!-- Test status - ONLY show when known -->
              <div
                v-if="activeProjectData.test_status === 'passing' || activeProjectData.test_status === 'failing'"
                class="flex items-center gap-2 text-sm"
              >
                <Check
                  v-if="activeProjectData.test_status === 'passing'"
                  class="w-3.5 h-3.5 text-emerald-500 shrink-0"
                />
                <X
                  v-else
                  class="w-3.5 h-3.5 text-red-500 shrink-0"
                />
                <span
                  :class="{
                    'text-emerald-600 dark:text-emerald-400': activeProjectData.test_status === 'passing',
                    'text-red-600 dark:text-red-400': activeProjectData.test_status === 'failing',
                  }"
                >
                  {{ humanizeTestStatus(activeProjectData.test_status, activeProjectData.test_summary) }}
                </span>
              </div>

              <!-- Dev server -->
              <div
                v-if="devServerText(activeProjectData)"
                class="flex items-center gap-2 text-sm text-foreground"
              >
                <Radio class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span>{{ devServerText(activeProjectData) }}</span>
              </div>

              <!-- Vercel deployment status -->
              <div
                v-if="deploymentInfo(activeProjectData)"
                class="flex items-center gap-2 text-sm"
              >
                <Triangle
                  class="w-3.5 h-3.5 shrink-0"
                  :class="{
                    'text-emerald-500': deploymentInfo(activeProjectData)!.state === 'ready',
                    'text-amber-500 animate-pulse': deploymentInfo(activeProjectData)!.state === 'building' || deploymentInfo(activeProjectData)!.state === 'queued',
                    'text-red-500': deploymentInfo(activeProjectData)!.state === 'error',
                    'text-muted-foreground': deploymentInfo(activeProjectData)!.state === 'cancelled' || deploymentInfo(activeProjectData)!.state === 'unknown',
                  }"
                />
                <span
                  :class="{
                    'text-emerald-600 dark:text-emerald-400': deploymentInfo(activeProjectData)!.state === 'ready',
                    'text-amber-600 dark:text-amber-400': deploymentInfo(activeProjectData)!.state === 'building' || deploymentInfo(activeProjectData)!.state === 'queued',
                    'text-red-600 dark:text-red-400': deploymentInfo(activeProjectData)!.state === 'error',
                    'text-muted-foreground': deploymentInfo(activeProjectData)!.state === 'cancelled' || deploymentInfo(activeProjectData)!.state === 'unknown',
                  }"
                >
                  {{ deploymentInfo(activeProjectData)!.text }}
                </span>
              </div>

              <!-- GitHub CI status -->
              <div
                v-if="githubCIInfo(activeProjectData)"
                class="flex items-center gap-2 text-sm"
              >
                <Check
                  v-if="githubCIInfo(activeProjectData)!.passing"
                  class="w-3.5 h-3.5 text-emerald-500 shrink-0"
                />
                <X
                  v-else
                  class="w-3.5 h-3.5 text-red-500 shrink-0"
                />
                <span
                  :class="{
                    'text-emerald-600 dark:text-emerald-400': githubCIInfo(activeProjectData)!.passing,
                    'text-red-600 dark:text-red-400': !githubCIInfo(activeProjectData)!.passing,
                  }"
                >
                  {{ githubCIInfo(activeProjectData)!.text }}
                </span>
              </div>

              <!-- GitHub open PRs -->
              <div
                v-if="githubPRText(activeProjectData)"
                class="flex items-center gap-2 text-sm text-foreground"
              >
                <GitPullRequest class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span>{{ githubPRText(activeProjectData) }}</span>
              </div>

              <!-- Last active time (only if no sessions at all) -->
              <div
                v-if="allProjectSessions(activeProjectData.name).length === 0 && lastActiveTime(activeProjectData.name)"
                class="text-xs text-muted-foreground"
              >
                Last active {{ lastActiveTime(activeProjectData.name) }}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue'
import type { Project, Session, HookEvent, DevLog } from '../types'
import {
  humanizeBranch,
  humanizeEvent,
  humanizeTestStatus,
  humanizeDevServer,
  humanizeDeployment,
  humanizeGitHubCI,
  humanizeGitHubPRs,
  humanizeTimeAgo,
  humanizeDuration,
  isNoisyEvent,
} from '../utils/plainEnglish'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { GitBranch, GitPullRequest, Check, X, Radio, Triangle, Activity, EyeOff, Clock, Zap } from 'lucide-vue-next'

interface TaskContext {
  prefix: string
  ticket_id: string
  description: string
  display: string
}

const props = defineProps<{
  projects: Project[]
  sessions: Session[]
  events: HookEvent[]
  devLogs: DevLog[]
}>()

// ---------------------------------------------------------------------------
// Tick counter to force re-evaluation of relative timestamps every 30s
// ---------------------------------------------------------------------------
const _tick = ref(0)
let _tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { _tickTimer = setInterval(() => { _tick.value++ }, 30000) })
onUnmounted(() => { if (_tickTimer) clearInterval(_tickTimer) })

// ---------------------------------------------------------------------------
// Hidden projects (persisted in localStorage)
// ---------------------------------------------------------------------------
const HIDDEN_KEY = 'devpulse-hidden-projects'

function loadHiddenProjects(): Set<string> {
  try {
    const stored = localStorage.getItem(HIDDEN_KEY)
    if (stored) return new Set(JSON.parse(stored))
  } catch { /* ignore */ }
  return new Set()
}

const hiddenProjects = reactive(loadHiddenProjects())

function saveHiddenProjects() {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenProjects]))
}

function hideProject(name: string) {
  hiddenProjects.add(name)
  saveHiddenProjects()
  // If we hid the active tab, switch to the first remaining
  if (activeProject.value === name) {
    const remaining = visibleProjects.value.filter(p => p.name !== name)
    activeProject.value = remaining[0]?.name ?? ''
  }
}

const visibleProjects = computed(() =>
  props.projects.filter(p => !hiddenProjects.has(p.name))
)

// ---------------------------------------------------------------------------
// Active project tab
// ---------------------------------------------------------------------------
const activeProject = ref('')

// Auto-select first project when list changes
watch(visibleProjects, (projects) => {
  if (projects.length > 0 && !projects.find(p => p.name === activeProject.value)) {
    activeProject.value = projects[0].name
  }
}, { immediate: true })

const activeProjectData = computed(() =>
  visibleProjects.value.find(p => p.name === activeProject.value) ?? null
)

// ---------------------------------------------------------------------------
// Alert system: track status changes since last tab view
// ---------------------------------------------------------------------------
const ALERT_KEY = 'devpulse-dashboard-last-seen'

function loadLastSeenStatus(): Map<string, string> {
  try {
    const stored = localStorage.getItem(ALERT_KEY)
    if (stored) return new Map(JSON.parse(stored))
  } catch { /* ignore */ }
  return new Map()
}

const lastSeenStatus = reactive(loadLastSeenStatus())

function saveLastSeenStatus() {
  localStorage.setItem(ALERT_KEY, JSON.stringify([...lastSeenStatus]))
}

/** When user clicks a tab, mark current status as "seen" (clears alert) */
function selectProject(name: string) {
  activeProject.value = name
  const status = projectStatus(name)
  lastSeenStatus.set(name, status)
  saveLastSeenStatus()
}

/** Check if a project tab should show an alert indicator */
function hasAlert(projectName: string): boolean {
  // No alert on the currently active tab
  if (activeProject.value === projectName) return false
  const currentStatus = projectStatus(projectName)
  const lastSeen = lastSeenStatus.get(projectName)
  // If never seen, no alert (first visit)
  if (lastSeen === undefined) return false
  return currentStatus !== lastSeen
}

// Mark the initial active project as seen
watch(activeProject, (name) => {
  if (name) {
    lastSeenStatus.set(name, projectStatus(name))
    saveLastSeenStatus()
  }
}, { immediate: true })

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/** All sessions for a project, sorted: active first, then waiting/idle, then stopped */
function allProjectSessions(projectName: string): Session[] {
  return props.sessions
    .filter(s => s.project_name === projectName)
    .sort((a, b) => {
      const order = { active: 0, waiting: 1, idle: 2, stopped: 3 }
      return (order[a.status] ?? 3) - (order[b.status] ?? 3)
    })
}

function liveSessions(projectName: string): Session[] {
  return props.sessions
    .filter(s => s.project_name === projectName && s.status !== 'stopped')
}

/** Check if the project has switched to a new branch that no session has reported on yet */
function hasNewBranch(projectName: string): boolean {
  const project = props.projects.find(p => p.name === projectName)
  if (!project?.current_branch) return false
  const sessions = props.sessions.filter(s => s.project_name === projectName)
  if (sessions.length === 0) return false
  // If the project's branch doesn't match ANY session branch, a new workstream started
  return !sessions.some(s => s.current_branch === project.current_branch)
}

function projectStatus(projectName: string): 'active' | 'idle' | 'starting' | 'stopped' {
  const related = props.sessions.filter(s => s.project_name === projectName)
  if (related.length === 0) return 'stopped'
  if (related.some(s => s.status === 'active')) return 'active'
  if (related.some(s => s.status === 'idle' || s.status === 'waiting')) return 'idle'
  // If all sessions are stopped but the project is on a new branch, show "starting"
  if (hasNewBranch(projectName)) return 'starting'
  return 'stopped'
}

function statusColor(projectName: string): string {
  const status = projectStatus(projectName)
  switch (status) {
    case 'active': return 'hsl(var(--status-active))'
    case 'idle': return 'hsl(var(--status-idle))'
    case 'starting': return 'hsl(var(--status-starting))'
    case 'stopped': return 'hsl(var(--status-stopped))'
  }
}

function statusLabel(projectName: string): string {
  const status = projectStatus(projectName)
  if (status === 'starting') {
    const project = props.projects.find(p => p.name === projectName)
    return project ? humanizeBranch(project.current_branch) : 'Starting'
  }
  const live = liveSessions(projectName)
  const all = allProjectSessions(projectName)
  const count = live.length
  const total = all.length
  switch (status) {
    case 'active': return count > 1 ? `${count} active` : total > 1 ? `${total} sessions` : 'Active'
    case 'idle': return count > 1 ? `${count} sessions` : total > 1 ? `${total} sessions` : 'Idle'
    case 'stopped': return total > 1 ? `${total} finished` : 'Stopped'
  }
}

function statusBadgeClass(projectName: string): string {
  const status = projectStatus(projectName)
  switch (status) {
    case 'active': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    case 'idle': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    case 'starting': return 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
    case 'stopped': return 'bg-muted text-muted-foreground'
  }
}

// ---------------------------------------------------------------------------
// Session status label
// ---------------------------------------------------------------------------

function sessionStatusLabel(session: Session): string {
  switch (session.status) {
    case 'active': return 'Working'
    case 'waiting': return 'Waiting for input'
    case 'idle': return 'Idle'
    case 'stopped': return 'Finished'
  }
}

// ---------------------------------------------------------------------------
// Task / Story name from session
// ---------------------------------------------------------------------------

/** Parse task_context JSON and return a meaningful task name */
function sessionTaskName(session: Session): string {
  if (session.task_context) {
    try {
      const ctx: TaskContext = JSON.parse(session.task_context)
      if (ctx.display && ctx.display !== session.current_branch) {
        return ctx.display
      }
    } catch { /* ignore */ }
  }
  // Fallback to humanized branch
  return humanizeBranch(session.current_branch)
}

// ---------------------------------------------------------------------------
// Session duration
// ---------------------------------------------------------------------------

function sessionDuration(session: Session): string {
  if (!session.started_at) return 'Unknown'
  // For stopped sessions, show total duration (started_at to last_event_at)
  const endTime = session.status === 'stopped' && session.last_event_at
    ? session.last_event_at
    : Date.now()
  const minutes = Math.round((endTime - session.started_at) / 60000)
  return humanizeDuration(minutes)
}

// ---------------------------------------------------------------------------
// Recent activities for a session (mini timeline)
// ---------------------------------------------------------------------------

interface ActivityEntry {
  description: string
  timestamp: number
}

/** Get the last N meaningful events for a specific session */
function recentSessionActivities(session: Session, count: number): ActivityEntry[] {
  const activities: ActivityEntry[] = []
  const seen = new Set<string>() // deduplicate consecutive identical descriptions

  for (let i = props.events.length - 1; i >= 0 && activities.length < count; i--) {
    const ev = props.events[i]
    if (ev.session_id !== session.session_id) continue
    if (isNoisyEvent(ev)) continue

    const desc = humanizeEvent(ev)

    // Skip garbage
    if (desc.includes('$(') || desc.includes('<<')) continue
    if (desc.startsWith('Ran:') || desc.startsWith('Running:')) {
      const cmdPart = desc.slice(desc.indexOf(':') + 2)
      if (cmdPart.length < 5) continue
    }

    // Deduplicate consecutive identical descriptions
    if (seen.has(desc)) continue
    seen.add(desc)

    activities.push({
      description: desc,
      timestamp: ev.timestamp ?? 0,
    })
  }

  return activities
}

// ---------------------------------------------------------------------------
// Dev log summary for stopped sessions
// ---------------------------------------------------------------------------

function sessionDevLogSummary(session: Session): string | null {
  for (let i = props.devLogs.length - 1; i >= 0; i--) {
    const log = props.devLogs[i]
    if (log.session_id === session.session_id && log.summary) {
      return log.summary
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Project-level helpers
// ---------------------------------------------------------------------------

function devServerText(project: Project): string | null {
  return humanizeDevServer(project.dev_servers)
}

function deploymentInfo(project: Project): { text: string; state: string } | null {
  return humanizeDeployment(project.deployment_status)
}

function githubCIInfo(project: Project): { text: string; passing: boolean } | null {
  return humanizeGitHubCI(project.github_status)
}

function githubPRText(project: Project): string | null {
  return humanizeGitHubPRs(project.github_status)
}

/** Wrapper that references _tick to force periodic re-evaluation of relative times */
function liveTimeAgo(ts: number): string {
  void _tick.value
  return humanizeTimeAgo(ts)
}

function lastActiveTime(projectName: string): string | null {
  void _tick.value
  const related = props.sessions
    .filter(s => s.project_name === projectName)
    .sort((a, b) => (b.last_event_at ?? 0) - (a.last_event_at ?? 0))
  if (related.length > 0 && related[0].last_event_at) {
    return humanizeTimeAgo(related[0].last_event_at)
  }
  return null
}
</script>
