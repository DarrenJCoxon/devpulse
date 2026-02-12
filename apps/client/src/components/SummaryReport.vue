<template>
  <div class="h-full overflow-y-auto bg-muted">
    <div class="max-w-6xl mx-auto w-full px-6 py-6 space-y-4">
      <!-- Controls -->
      <Card>
        <CardContent class="p-4 flex items-center justify-between gap-4">
          <!-- Period toggle -->
          <div class="flex items-center gap-2">
            <button
              @click="period = 'daily'"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="period === 'daily'
                ? 'bg-primary text-white'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
            >
              Daily
            </button>
            <button
              @click="period = 'weekly'"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="period === 'weekly'
                ? 'bg-primary text-white'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
            >
              Weekly
            </button>
          </div>

          <!-- Date navigation -->
          <div class="flex items-center gap-2">
            <button
              @click="navigatePrevious"
              class="p-2 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
              title="Previous"
            >
              &#9664;
            </button>
            <div class="text-sm font-medium text-foreground min-w-[200px] text-center">
              {{ displayDate }}
            </div>
            <button
              @click="navigateNext"
              class="p-2 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
              title="Next"
            >
              &#9654;
            </button>
          </div>
        </CardContent>
      </Card>

      <!-- Loading state -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <div class="text-muted-foreground">
          <div class="animate-spin text-3xl mb-2">&#8987;</div>
          <p class="text-sm">Loading summary...</p>
        </div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="flex flex-col items-center justify-center py-16 text-red-600">
        <span class="text-4xl mb-3">&#9888;&#65039;</span>
        <p class="text-lg font-medium">Error loading summary</p>
        <p class="text-sm mt-1">{{ error }}</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="!summary || summary.projects.length === 0" class="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <span class="text-4xl mb-3">&#128202;</span>
        <p class="text-lg font-medium">No activity for this {{ period === 'daily' ? 'day' : 'week' }}</p>
        <p class="text-sm mt-1">Complete a Claude Code session to see summaries</p>
      </div>

      <!-- Summary content -->
      <template v-else>
        <!-- Totals bar -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent class="p-4">
              <div class="text-2xl font-bold text-primary">{{ summary.totals.active_projects }}</div>
              <div class="text-xs text-muted-foreground mt-1">Projects</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-4">
              <div class="text-2xl font-bold text-primary">{{ summary.totals.total_sessions }}</div>
              <div class="text-xs text-muted-foreground mt-1">Sessions</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-4">
              <div class="text-2xl font-bold text-primary">{{ formatDuration(summary.totals.total_duration_minutes) }}</div>
              <div class="text-xs text-muted-foreground mt-1">Duration</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-4">
              <div class="text-2xl font-bold text-primary">{{ summary.totals.total_files_changed }}</div>
              <div class="text-xs text-muted-foreground mt-1">Files Changed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-4">
              <div class="text-2xl font-bold text-primary">{{ summary.totals.total_commits }}</div>
              <div class="text-xs text-muted-foreground mt-1">Commits</div>
            </CardContent>
          </Card>
        </div>

        <!-- Project cards -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card
            v-for="project in summary.projects"
            :key="project.project_name"
            class="hover:shadow-md transition-shadow overflow-hidden"
          >
            <!-- Card header -->
            <CardHeader class="pb-3 border-b border-border">
              <div class="flex items-center gap-2">
                <span class="text-lg">&#128193;</span>
                <CardTitle class="text-base font-semibold">{{ project.project_name }}</CardTitle>
              </div>
            </CardHeader>

            <!-- Card body -->
            <CardContent class="px-4 py-3 space-y-3">
              <!-- Stats row -->
              <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span class="text-muted-foreground">Sessions:</span>
                  <span class="ml-1 font-medium text-foreground">{{ project.session_count }}</span>
                </div>
                <div>
                  <span class="text-muted-foreground">Duration:</span>
                  <span class="ml-1 font-medium text-foreground">{{ formatDuration(project.total_duration_minutes) }}</span>
                </div>
                <div>
                  <span class="text-muted-foreground">Files:</span>
                  <span class="ml-1 font-medium text-foreground">{{ project.files_changed.length }}</span>
                </div>
                <div>
                  <span class="text-muted-foreground">Commits:</span>
                  <span class="ml-1 font-medium text-foreground">{{ project.commit_count }}</span>
                </div>
              </div>

              <!-- Tool breakdown -->
              <div v-if="Object.keys(project.tool_breakdown).length > 0">
                <div class="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  Tool Usage
                </div>
                <div class="flex flex-wrap gap-2">
                  <div
                    v-for="[tool, count] in topTools(project.tool_breakdown, 5)"
                    :key="tool"
                    class="flex items-center gap-1.5 text-xs bg-muted/50 px-2.5 py-1 rounded"
                  >
                    <span>{{ toolIcon(tool) }}</span>
                    <span class="font-medium text-muted-foreground">{{ tool }}</span>
                    <span class="text-muted-foreground">x{{ count }}</span>
                  </div>
                </div>
              </div>

              <!-- Commits -->
              <div v-if="project.commits.length > 0">
                <div class="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  Commits ({{ project.commits.length }})
                </div>
                <div class="space-y-1 max-h-32 overflow-y-auto">
                  <div
                    v-for="(commit, index) in project.commits.slice(0, 5)"
                    :key="index"
                    class="text-xs bg-muted/50 px-2 py-1 rounded text-muted-foreground"
                  >
                    {{ commit }}
                  </div>
                  <div v-if="project.commits.length > 5" class="text-xs text-muted-foreground px-2 py-1">
                    +{{ project.commits.length - 5 }} more
                  </div>
                </div>
              </div>

              <!-- Most changed files -->
              <div v-if="project.files_changed.length > 0">
                <div class="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  Files Changed ({{ project.files_changed.length }})
                </div>
                <div class="space-y-1 max-h-32 overflow-y-auto">
                  <div
                    v-for="(file, index) in project.files_changed.slice(0, 5)"
                    :key="index"
                    class="text-xs font-mono bg-muted/50 px-2 py-1 rounded text-muted-foreground truncate"
                    :title="file"
                  >
                    {{ file }}
                  </div>
                  <div v-if="project.files_changed.length > 5" class="text-xs text-muted-foreground px-2 py-1">
                    +{{ project.files_changed.length - 5 }} more
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { PeriodSummary } from '../types';
import { API_BASE_URL } from '../config';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

// State
const period = ref<'daily' | 'weekly'>('daily');
const currentDate = ref<Date>(new Date());
const summary = ref<PeriodSummary | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

// Computed display date
const displayDate = computed(() => {
  if (period.value === 'daily') {
    return formatDisplayDate(currentDate.value);
  } else {
    const { year, week } = getISOWeek(currentDate.value);
    return `Week ${week}, ${year}`;
  }
});

// Fetch summary when period or date changes
watch([period, currentDate], () => {
  fetchSummary();
}, { immediate: true });

// Navigation
function navigatePrevious() {
  if (period.value === 'daily') {
    const newDate = new Date(currentDate.value);
    newDate.setDate(newDate.getDate() - 1);
    currentDate.value = newDate;
  } else {
    const newDate = new Date(currentDate.value);
    newDate.setDate(newDate.getDate() - 7);
    currentDate.value = newDate;
  }
}

function navigateNext() {
  if (period.value === 'daily') {
    const newDate = new Date(currentDate.value);
    newDate.setDate(newDate.getDate() + 1);
    currentDate.value = newDate;
  } else {
    const newDate = new Date(currentDate.value);
    newDate.setDate(newDate.getDate() + 7);
    currentDate.value = newDate;
  }
}

// Fetch summary from API
async function fetchSummary() {
  loading.value = true;
  error.value = null;

  try {
    let url: string;
    if (period.value === 'daily') {
      const dateStr = formatISODate(currentDate.value);
      url = `${API_BASE_URL}/api/summaries?period=daily&date=${dateStr}`;
    } else {
      const { year, week } = getISOWeek(currentDate.value);
      const weekStr = `${year}-W${String(week).padStart(2, '0')}`;
      url = `${API_BASE_URL}/api/summaries?period=weekly&week=${weekStr}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to fetch summary');
    }

    summary.value = await response.json();
  } catch (err: unknown) {
    error.value = (err instanceof Error ? err.message : String(err)) || 'Failed to fetch summary';
    summary.value = null;
  } finally {
    loading.value = false;
  }
}

// Helper functions
function formatISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function getISOWeek(date: Date): { year: number; week: number } {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const dayDiff = (target.valueOf() - jan4.valueOf()) / 86400000;
  const weekNr = 1 + Math.ceil(dayDiff / 7);
  return { year: target.getFullYear(), week: weekNr };
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function topTools(breakdown: Record<string, number>, limit: number): [string, number][] {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function toolIcon(tool: string): string {
  const icons: Record<string, string> = {
    'Read': '\u{1F4D6}',
    'Write': '\u270F\uFE0F',
    'Edit': '\u{1F4DD}',
    'Bash': '\u26A1',
    'Grep': '\u{1F50D}',
    'Glob': '\u{1F4C2}',
    'WebSearch': '\u{1F310}',
    'WebFetch': '\u{1F310}'
  };
  return icons[tool] || '\u{1F527}';
}
</script>
