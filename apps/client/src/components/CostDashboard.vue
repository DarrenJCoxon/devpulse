<template>
  <div class="h-full overflow-auto bg-muted p-4">
    <div class="max-w-7xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-foreground">
          Cost Dashboard
        </h2>
        <span class="text-sm text-muted-foreground italic">
          All costs are estimated based on event payload sizes
        </span>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center items-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        {{ error }}
      </div>

      <!-- Dashboard Content -->
      <template v-else>
        <!-- Project Cost Cards -->
        <section>
          <h3 class="text-lg font-semibold text-foreground mb-3">
            Cost by Project
          </h3>

          <div v-if="projectCosts.length === 0" class="text-center py-12 text-muted-foreground">
            No cost data available yet. Costs are tracked as events flow through the system.
          </div>

          <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card
              v-for="project in projectCosts"
              :key="project.project_name"
              class="shadow hover:shadow-lg transition-shadow cursor-pointer"
              @click="selectedProject = project.project_name"
            >
              <CardContent class="p-4">
                <div class="flex items-start justify-between mb-3">
                  <h4 class="font-semibold text-foreground truncate">
                    {{ project.project_name }}
                  </h4>
                  <span class="text-xs bg-primary text-white px-2 py-1 rounded">
                    {{ project.session_count }} sessions
                  </span>
                </div>

                <div class="space-y-2">
                  <div class="flex justify-between items-baseline">
                    <span class="text-sm text-muted-foreground">Estimated Cost</span>
                    <span class="text-xl font-bold text-primary">
                      ~${{ project.total_cost_usd.toFixed(4) }}
                    </span>
                  </div>

                  <div class="flex justify-between items-baseline text-xs">
                    <span class="text-muted-foreground">Input Tokens</span>
                    <span class="text-muted-foreground">
                      {{ formatNumber(project.total_input_tokens) }}
                    </span>
                  </div>

                  <div class="flex justify-between items-baseline text-xs">
                    <span class="text-muted-foreground">Output Tokens</span>
                    <span class="text-muted-foreground">
                      {{ formatNumber(project.total_output_tokens) }}
                    </span>
                  </div>

                  <!-- Model distribution -->
                  <div v-if="Object.keys(project.model_distribution).length > 0" class="pt-2 border-t border-border">
                    <div class="text-xs text-muted-foreground mb-1">Models Used</div>
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="(count, model) in project.model_distribution"
                        :key="model"
                        class="text-xs bg-muted/50 px-2 py-0.5 rounded"
                        :title="`${count} sessions with ${model}`"
                      >
                        {{ getModelDisplayName(String(model)) }} ({{ count }})
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <!-- Session Breakdown (shown when project is selected) -->
        <Card v-if="selectedProject">
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-lg font-semibold">
                Sessions for {{ selectedProject }}
              </CardTitle>
              <button
                @click="selectedProject = null"
                class="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
          </CardHeader>

          <CardContent>
            <div v-if="loadingSessionCosts" class="flex justify-center py-8">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>

            <div v-else-if="sessionCosts.length === 0" class="text-center py-8 text-muted-foreground">
              No sessions found for this project
            </div>

            <div v-else class="overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-border text-left">
                    <th class="pb-2 text-xs font-semibold text-muted-foreground uppercase">Session</th>
                    <th class="pb-2 text-xs font-semibold text-muted-foreground uppercase">Model</th>
                    <th class="pb-2 text-xs font-semibold text-muted-foreground uppercase text-right">Duration</th>
                    <th class="pb-2 text-xs font-semibold text-muted-foreground uppercase text-right">Tokens</th>
                    <th class="pb-2 text-xs font-semibold text-muted-foreground uppercase text-right">Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="session in sessionCosts"
                    :key="`${session.source_app}:${session.session_id}`"
                    class="border-b border-border hover:bg-muted/50 transition-colors"
                  >
                    <td class="py-3 text-sm">
                      <div class="font-mono text-muted-foreground">
                        {{ truncateSessionId(session.session_id) }}
                      </div>
                      <div class="text-xs text-muted-foreground">
                        {{ session.event_count }} events
                      </div>
                    </td>
                    <td class="py-3 text-sm text-muted-foreground">
                      {{ getModelDisplayName(session.model_name) }}
                    </td>
                    <td class="py-3 text-sm text-muted-foreground text-right">
                      {{ session.duration_minutes }}m
                    </td>
                    <td class="py-3 text-sm text-muted-foreground text-right">
                      <div>{{ formatNumber(session.estimated_input_tokens) }} in</div>
                      <div>{{ formatNumber(session.estimated_output_tokens) }} out</div>
                    </td>
                    <td class="py-3 text-sm font-semibold text-primary text-right">
                      ~${{ session.estimated_cost_usd.toFixed(4) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <!-- Daily Cost Chart -->
        <Card>
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-lg font-semibold">
                Daily Cost Trend
              </CardTitle>
              <div class="flex space-x-2">
                <button
                  v-for="option in [7, 14, 30]"
                  :key="option"
                  @click="selectedDays = option"
                  class="px-3 py-1 text-sm rounded transition-colors"
                  :class="selectedDays === option
                    ? 'bg-primary text-white'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
                >
                  {{ option }}d
                </button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div v-if="loadingDailyCosts" class="flex justify-center py-8">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>

            <div v-else-if="dailyCosts.length === 0" class="text-center py-8 text-muted-foreground">
              No daily cost data available
            </div>

            <!-- Simple Bar Chart -->
            <div v-else class="relative h-48">
              <div class="flex items-end justify-between h-full space-x-1">
                <div
                  v-for="(day, index) in dailyCosts"
                  :key="day.date"
                  class="flex-1 flex flex-col items-center"
                >
                  <!-- Bar -->
                  <div
                    class="w-full bg-primary rounded-t transition-all hover:opacity-80 cursor-pointer"
                    :style="{ height: getBarHeight(day.total_cost_usd) }"
                    :title="`${day.date}: ~$${day.total_cost_usd.toFixed(4)}`"
                  ></div>
                  <!-- Date label (show every nth label to avoid crowding) -->
                  <div
                    v-if="shouldShowDateLabel(index)"
                    class="text-xs text-muted-foreground mt-2 transform -rotate-45 origin-top-left"
                  >
                    {{ formatDate(day.date) }}
                  </div>
                </div>
              </div>

              <!-- Y-axis label -->
              <div class="absolute top-0 left-0 -translate-x-full pr-2 text-xs text-muted-foreground">
                ${{ maxDailyCost.toFixed(2) }}
              </div>
              <div class="absolute bottom-0 left-0 -translate-x-full pr-2 text-xs text-muted-foreground">
                $0
              </div>
            </div>

            <!-- Daily cost summary -->
            <div class="mt-4 pt-4 border-t border-border flex justify-between items-center">
              <span class="text-sm text-muted-foreground">
                Total (last {{ selectedDays }} days)
              </span>
              <span class="text-lg font-bold text-primary">
                ~${{ totalDailyCost.toFixed(4) }}
              </span>
            </div>
          </CardContent>
        </Card>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ProjectCost, SessionCost, DailyCost } from '../types';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// State
const loading = ref(true);
const error = ref<string | null>(null);
const projectCosts = ref<ProjectCost[]>([]);
const sessionCosts = ref<SessionCost[]>([]);
const dailyCosts = ref<DailyCost[]>([]);
const selectedProject = ref<string | null>(null);
const selectedDays = ref(7);
const loadingSessionCosts = ref(false);
const loadingDailyCosts = ref(false);

// Fetch project costs
async function fetchProjectCosts() {
  try {
    const response = await fetch(`${API_URL}/api/costs?group=project`);
    if (!response.ok) throw new Error('Failed to fetch project costs');
    projectCosts.value = await response.json();
  } catch (err: any) {
    error.value = err.message || 'Failed to load project costs';
  }
}

// Fetch session costs for selected project
async function fetchSessionCosts(projectName: string) {
  loadingSessionCosts.value = true;
  try {
    const response = await fetch(`${API_URL}/api/costs?group=session&project=${encodeURIComponent(projectName)}`);
    if (!response.ok) throw new Error('Failed to fetch session costs');
    sessionCosts.value = await response.json();
  } catch (err: any) {
    error.value = err.message || 'Failed to load session costs';
  } finally {
    loadingSessionCosts.value = false;
  }
}

// Fetch daily costs
async function fetchDailyCosts() {
  loadingDailyCosts.value = true;
  try {
    const response = await fetch(`${API_URL}/api/costs?group=daily&days=${selectedDays.value}`);
    if (!response.ok) throw new Error('Failed to fetch daily costs');
    dailyCosts.value = await response.json();
  } catch (err: any) {
    error.value = err.message || 'Failed to load daily costs';
  } finally {
    loadingDailyCosts.value = false;
  }
}

// Initial load
async function loadAll() {
  loading.value = true;
  error.value = null;
  await Promise.all([
    fetchProjectCosts(),
    fetchDailyCosts()
  ]);
  loading.value = false;
}

loadAll();

// Watch for project selection changes
watch(selectedProject, (newProject) => {
  if (newProject) {
    fetchSessionCosts(newProject);
  }
});

// Watch for days selection changes
watch(selectedDays, () => {
  fetchDailyCosts();
});

// Computed values
const maxDailyCost = computed(() => {
  if (dailyCosts.value.length === 0) return 0;
  return Math.max(...dailyCosts.value.map(d => d.total_cost_usd), 0.01); // Min 0.01 to avoid division by zero
});

const totalDailyCost = computed(() => {
  return dailyCosts.value.reduce((sum, d) => sum + d.total_cost_usd, 0);
});

// Helper functions
function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toString();
}

function truncateSessionId(sessionId: string): string {
  return sessionId.length > 12 ? sessionId.substring(0, 12) + '...' : sessionId;
}

function getModelDisplayName(modelName: string): string {
  const lower = (modelName || '').toLowerCase();
  if (lower.includes('opus')) return 'Opus 4.6';
  if (lower.includes('sonnet')) return 'Sonnet 4.5';
  if (lower.includes('haiku')) return 'Haiku 4.5';
  return modelName || 'Unknown';
}

function getBarHeight(cost: number): string {
  if (maxDailyCost.value === 0) return '0%';
  const percentage = (cost / maxDailyCost.value) * 100;
  return `${Math.max(percentage, 2)}%`; // Minimum 2% for visibility
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function shouldShowDateLabel(index: number): boolean {
  // Show every nth label based on number of days to avoid crowding
  const interval = selectedDays.value <= 7 ? 1 : selectedDays.value <= 14 ? 2 : 3;
  return index % interval === 0 || index === dailyCosts.value.length - 1;
}
</script>
