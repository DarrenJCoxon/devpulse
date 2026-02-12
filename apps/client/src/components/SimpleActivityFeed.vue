<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { HookEvent, Session, Project } from '../types'
import {
  humanizeEvent,
  humanizeTimeAgo,
  getProjectColor,
  isNoisyEvent,
} from '../utils/plainEnglish'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'

const props = defineProps<{
  events: HookEvent[]
  sessions: Session[]
  projects: Project[]
}>()

const searchQuery = ref('')

// Tick counter to force re-evaluation of relative timestamps every 30s
const _tick = ref(0)
let _tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { _tickTimer = setInterval(() => { _tick.value++ }, 30000) })
onUnmounted(() => { if (_tickTimer) clearInterval(_tickTimer) })

// Build a lookup map from "source_app:session_id_prefix" to project name
const sessionProjectMap = computed(() => {
  const map = new Map<string, string>()
  for (const session of props.sessions) {
    const key = `${session.source_app}:${session.session_id.slice(0, 8)}`
    map.set(key, session.project_name)
  }
  return map
})

// Also build from session_id alone (events may not have source_app prefix)
const sessionIdMap = computed(() => {
  const map = new Map<string, string>()
  for (const session of props.sessions) {
    map.set(session.session_id, session.project_name)
  }
  return map
})

// Collect all unique project names for stable color assignment
const allProjectNames = computed(() => {
  const names = new Set<string>()
  for (const session of props.sessions) {
    if (session.project_name) names.add(session.project_name)
  }
  return [...names]
})

// Hidden projects (loaded once from localStorage, updated via storage events)
function loadHidden(): Set<string> {
  try {
    const stored = localStorage.getItem('devpulse-hidden-projects')
    if (stored) return new Set<string>(JSON.parse(stored))
  } catch { /* ignore */ }
  return new Set<string>()
}
const hiddenProjects = ref(loadHidden())
function onStorageChange(e: StorageEvent) {
  if (e.key === 'devpulse-hidden-projects') hiddenProjects.value = loadHidden()
}
onMounted(() => window.addEventListener('storage', onStorageChange))
onUnmounted(() => window.removeEventListener('storage', onStorageChange))

// Event types that are always shown regardless of tool name
const ALWAYS_SHOW_TYPES = new Set([
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'PostToolUseFailure',
])

function shouldShowEvent(event: HookEvent): boolean {
  const type = event.hook_event_type ?? ''
  if (ALWAYS_SHOW_TYPES.has(type)) return true
  if (isNoisyEvent(event)) return false
  if (type === 'PostToolUse') return true
  if (type === 'PreToolUse') {
    const toolName = event.payload?.tool_name ?? ''
    return toolName === 'Write' || toolName === 'Edit'
  }
  return false
}

function resolveProjectName(event: HookEvent): string | null {
  const key = `${event.source_app}:${event.session_id.slice(0, 8)}`
  const name = sessionProjectMap.value.get(key) || sessionIdMap.value.get(event.session_id)
  return name || null
}

interface ActivityItem {
  id: number | string
  projectName: string
  description: string
  timeAgo: string
  timestamp: number
  color: string
}

const filteredItems = computed<ActivityItem[]>(() => {
  void _tick.value // force periodic re-evaluation for relative timestamps
  const query = searchQuery.value.toLowerCase().trim()
  const projectNames = allProjectNames.value
  const hidden = hiddenProjects.value

  const items: ActivityItem[] = []
  let lastDesc = ''
  let lastProject = ''

  // Process events from newest to oldest
  const sorted = [...props.events].sort(
    (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
  )

  for (const event of sorted) {
    if (items.length >= 100) break

    if (!shouldShowEvent(event)) continue

    const projectName = resolveProjectName(event)

    // Filter out events with no known project
    if (!projectName) continue

    // Filter out hidden projects
    if (hidden.has(projectName)) continue

    const description = humanizeEvent(event)

    // Skip garbage bash fragments
    if (description.includes('$(') || description.includes('<<')) continue

    // Deduplicate consecutive identical entries from same project
    if (description === lastDesc && projectName === lastProject) continue
    lastDesc = description
    lastProject = projectName

    const color = getProjectColor(projectName, projectNames)

    // Apply search filter
    if (query) {
      const matchTarget = `${projectName} ${description}`.toLowerCase()
      if (!matchTarget.includes(query)) continue
    }

    items.push({
      id: event.id ?? `${event.session_id}-${event.timestamp}`,
      projectName,
      description,
      timeAgo: humanizeTimeAgo(event.timestamp ?? 0),
      timestamp: event.timestamp ?? 0,
      color,
    })
  }

  return items
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="max-w-6xl mx-auto w-full px-6">
      <div class="shrink-0 pt-6 pb-3">
        <Input
          v-model="searchQuery"
          placeholder="Search activity..."
        />
      </div>
    </div>

    <ScrollArea class="flex-1 min-h-0">
      <div class="max-w-6xl mx-auto w-full px-6 pb-6">
        <div
          v-if="filteredItems.length === 0"
          class="flex items-center justify-center py-12 text-sm text-muted-foreground"
        >
          <p v-if="searchQuery">No matching activity found.</p>
          <p v-else>
            No activity yet. Events will appear as Claude Code sessions send them.
          </p>
        </div>

        <div v-else class="flex flex-col">
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="border-b border-border/50 py-3 pl-3"
            :style="{ borderLeftWidth: '3px', borderLeftColor: `hsl(${item.color})` }"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-sm font-medium text-foreground">
                {{ item.projectName }}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ item.timeAgo }}
              </span>
            </div>
            <div class="mt-0.5 text-sm text-muted-foreground">
              {{ item.description }}
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
