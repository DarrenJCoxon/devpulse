<template>
  <div class="flex flex-col h-full">
    <!-- Empty state -->
    <div
      v-if="projectGroups.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-muted-foreground"
    >
      <p class="text-lg font-medium">No dev notes yet</p>
      <p class="text-sm mt-1">
        Notes are automatically created when Claude Code sessions end.
      </p>
    </div>

    <template v-else>
      <!-- Project tabs -->
      <div class="border-b border-border px-6">
        <div class="max-w-6xl mx-auto w-full flex items-center gap-1.5 pt-3 -mb-px overflow-x-auto">
          <button
            v-for="group in projectGroups"
            :key="group.projectName"
            @click="activeProject = group.projectName"
            class="group relative flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border transition-colors shrink-0"
            :class="activeProject === group.projectName
              ? 'border-border border-b-background bg-background text-foreground shadow-sm'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'"
          >
            <!-- Colored dot -->
            <span
              class="w-2 h-2 rounded-full shrink-0"
              :style="{ backgroundColor: `hsl(${getProjectColor(group.projectName, allProjectNames)})` }"
            />
            {{ group.projectName }}
            <span class="text-xs text-muted-foreground ml-0.5">({{ group.logs.length }})</span>
            <!-- Close button -->
            <span
              @click.stop="dismissProject(group.projectName)"
              class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
              title="Dismiss project"
            >
              <X class="w-3 h-3" />
            </span>
          </button>
        </div>
      </div>

      <!-- Dev note cards for active project -->
      <ScrollArea class="flex-1">
        <div class="max-w-6xl mx-auto w-full px-6 py-6">
          <div v-if="activeGroup" class="space-y-4">
            <Card v-for="log in activeGroup.logs" :key="`${log.session_id}-${log.source_app}`">
              <CardContent class="p-5 space-y-4">
                <!-- Header: branch name + timestamp -->
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-base font-semibold text-foreground">
                      {{ humanizeBranch(log.branch) }}
                    </p>
                    <div class="flex items-center gap-2 mt-0.5">
                      <GitBranch class="w-3 h-3 text-muted-foreground shrink-0" />
                      <span class="text-xs text-muted-foreground font-mono">
                        {{ log.branch }}
                      </span>
                    </div>
                  </div>
                  <span class="text-xs text-muted-foreground shrink-0 pt-0.5">
                    {{ formatTimestamp(log.ended_at) }}
                  </span>
                </div>

                <!-- Summary (the main "note" content) -->
                <p v-if="log.summary" class="text-sm text-foreground leading-relaxed">
                  {{ log.summary }}
                </p>

                <!-- Stats bar -->
                <div class="flex items-center gap-4 text-xs text-muted-foreground">
                  <span class="flex items-center gap-1">
                    <Clock class="h-3.5 w-3.5 shrink-0" />
                    {{ humanizeDuration(log.duration_minutes) }}
                  </span>
                  <span v-if="getFileCount(log) > 0" class="flex items-center gap-1">
                    <FileText class="h-3.5 w-3.5 shrink-0" />
                    {{ getFileCount(log) }} file{{ getFileCount(log) !== 1 ? 's' : '' }} changed
                  </span>
                  <span v-if="getCleanCommits(log).length > 0" class="flex items-center gap-1">
                    <GitCommit class="h-3.5 w-3.5 shrink-0" />
                    {{ getCleanCommits(log).length }} commit{{ getCleanCommits(log).length !== 1 ? 's' : '' }}
                  </span>
                  <span v-if="getToolSummary(log)" class="flex items-center gap-1">
                    <Zap class="h-3.5 w-3.5 shrink-0" />
                    {{ getToolSummary(log) }}
                  </span>
                </div>

                <!-- Commits section -->
                <div v-if="getCleanCommits(log).length > 0" class="rounded-md bg-muted/40 p-3 space-y-1.5">
                  <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <GitCommit class="h-3.5 w-3.5 shrink-0" />
                    <span>Commits</span>
                  </div>
                  <ul class="space-y-1 pl-5">
                    <li
                      v-for="(commit, idx) in getCleanCommits(log)"
                      :key="idx"
                      class="text-sm text-foreground list-disc"
                    >
                      {{ commit }}
                    </li>
                  </ul>
                </div>

                <!-- Files section -->
                <div v-if="getFiles(log).length > 0" class="rounded-md bg-muted/40 p-3 space-y-1.5">
                  <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <FileText class="h-3.5 w-3.5 shrink-0" />
                    <span>Files touched</span>
                  </div>
                  <div class="flex flex-wrap gap-1.5 mt-1">
                    <span
                      v-for="(file, idx) in getDisplayFiles(log)"
                      :key="idx"
                      class="text-xs font-mono px-1.5 py-0.5 rounded bg-background border border-border text-foreground"
                    >
                      {{ file }}
                    </span>
                    <span
                      v-if="getFiles(log).length > 8"
                      class="text-xs text-muted-foreground px-1.5 py-0.5"
                    >
                      +{{ getFiles(log).length - 8 }} more
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </ScrollArea>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DevLog, Project } from '../types'
import { humanizeBranch, humanizeDuration, getProjectColor } from '../utils/plainEnglish'
import { Card, CardContent } from './ui/card'
import { ScrollArea } from './ui/scroll-area'
import { GitBranch, GitCommit, FileText, Clock, X, Zap } from 'lucide-vue-next'

const props = defineProps<{
  devLogs: DevLog[]
  projects: Project[]
}>()

// ---------------------------------------------------------------------------
// Dismissed projects (persisted in localStorage, separate from hidden)
// ---------------------------------------------------------------------------
const DISMISSED_KEY = 'devpulse-dismissed-devnote-projects'

function loadDismissed(): Set<string> {
  try {
    const stored = localStorage.getItem(DISMISSED_KEY)
    if (stored) return new Set(JSON.parse(stored))
  } catch { /* ignore */ }
  return new Set()
}

const dismissedProjects = ref(loadDismissed())

function dismissProject(name: string) {
  dismissedProjects.value.add(name)
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedProjects.value]))
  // If we dismissed the active tab, switch to the first remaining
  if (activeProject.value === name) {
    const remaining = projectGroups.value.filter(g => g.projectName !== name)
    activeProject.value = remaining[0]?.projectName ?? ''
  }
}

// ---------------------------------------------------------------------------
// Deduplication: keep only the latest entry per session_id + source_app
// ---------------------------------------------------------------------------
const deduplicatedLogs = computed<DevLog[]>(() => {
  const map = new Map<string, DevLog>()
  for (const log of props.devLogs) {
    const key = `${log.session_id}::${log.source_app}`
    const existing = map.get(key)
    if (!existing || log.ended_at > existing.ended_at) {
      map.set(key, log)
    }
  }
  return Array.from(map.values())
})

// ---------------------------------------------------------------------------
// All project names (for stable color assignment)
// ---------------------------------------------------------------------------
const allProjectNames = computed<string[]>(() => {
  const names = new Set<string>()
  for (const log of deduplicatedLogs.value) {
    names.add(log.project_name)
  }
  return Array.from(names)
})

// ---------------------------------------------------------------------------
// Group by project, sorted by most recent activity
// ---------------------------------------------------------------------------
interface ProjectGroup {
  projectName: string
  logs: DevLog[]
  latestEndedAt: number
}

const projectGroups = computed<ProjectGroup[]>(() => {
  const dismissed = dismissedProjects.value
  const groupMap = new Map<string, DevLog[]>()

  for (const log of deduplicatedLogs.value) {
    if (dismissed.has(log.project_name)) continue

    const existing = groupMap.get(log.project_name)
    if (existing) {
      existing.push(log)
    } else {
      groupMap.set(log.project_name, [log])
    }
  }

  const groups: ProjectGroup[] = []

  for (const [projectName, logs] of groupMap) {
    logs.sort((a, b) => b.ended_at - a.ended_at)

    groups.push({
      projectName,
      logs,
      latestEndedAt: logs[0].ended_at,
    })
  }

  groups.sort((a, b) => b.latestEndedAt - a.latestEndedAt)
  return groups
})

// ---------------------------------------------------------------------------
// Active project tab
// ---------------------------------------------------------------------------
const activeProject = ref('')

// Auto-select first project when groups change
watch(projectGroups, (groups) => {
  if (groups.length > 0 && !groups.find(g => g.projectName === activeProject.value)) {
    activeProject.value = groups[0].projectName
  }
}, { immediate: true })

const activeGroup = computed(() =>
  projectGroups.value.find(g => g.projectName === activeProject.value) ?? null
)

// ---------------------------------------------------------------------------
// JSON parsers
// ---------------------------------------------------------------------------
function getCommits(log: DevLog): string[] {
  try {
    const parsed = JSON.parse(log.commits || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getCleanCommits(log: DevLog): string[] {
  return getCommits(log).filter(c => {
    if (!c || typeof c !== 'string') return false
    const trimmed = c.trim()
    if (trimmed.length < 3) return false
    if (trimmed.includes('$(cat') || trimmed.includes('<<') || trimmed.includes('EOF')) return false
    if (trimmed.startsWith('Co-Authored')) return false
    return true
  })
}

function getFiles(log: DevLog): string[] {
  try {
    const parsed = JSON.parse(log.files_changed || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getFileCount(log: DevLog): number {
  return getFiles(log).length
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function extractFilename(filePath: string): string {
  if (!filePath) return ''
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

/** Get deduplicated filenames for display (up to 8) */
function getDisplayFiles(log: DevLog): string[] {
  const files = getFiles(log)
  const names = [...new Set(files.map(extractFilename))]
  return names.slice(0, 8)
}

// ---------------------------------------------------------------------------
// Tool summary — e.g. "ran 94 commands"
// ---------------------------------------------------------------------------
function getToolSummary(log: DevLog): string {
  try {
    const breakdown = JSON.parse(log.tool_breakdown || '{}')
    const total = Object.values(breakdown).reduce((sum: number, n) => sum + (n as number), 0) as number
    if (total === 0) return ''
    return `${total} action${total !== 1 ? 's' : ''}`
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------
function formatTimestamp(timestamp: number): string {
  if (!timestamp) return ''

  const date = new Date(timestamp)
  const now = new Date()

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return `Today at ${timeStr}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return `Yesterday at ${timeStr}`
  }

  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  return `${dateStr} at ${timeStr}`
}
</script>
