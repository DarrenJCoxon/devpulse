<template>
  <Card>
    <CardContent class="p-4">
      <!-- Header with filter -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-foreground">
          <span class="mr-2">📅</span>
          Activity Heatmap
        </h3>

        <!-- Project filter dropdown -->
        <div class="flex items-center gap-2">
          <label class="text-sm text-muted-foreground font-medium">Project:</label>
          <select
            v-model="selectedProject"
            @change="fetchHeatmapData"
            class="px-3 py-1.5 text-sm rounded-lg bg-muted/50 text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">All Projects</option>
            <option v-for="project in projects" :key="project.name" :value="project.name">
              {{ project.name }}
            </option>
          </select>
        </div>
      </div>

      <!-- Canvas container -->
      <div ref="chartContainer" class="relative">
        <canvas
          ref="canvas"
          class="w-full cursor-crosshair"
          :style="{ height: canvasHeight + 'px' }"
          @mousemove="handleMouseMove"
          @mouseleave="handleMouseLeave"
          role="img"
          :aria-label="chartAriaLabel"
        ></canvas>

        <!-- Tooltip -->
        <div
          v-if="tooltip.visible"
          class="absolute bg-primary text-white rounded-lg px-3 py-2 text-xs font-bold shadow-lg pointer-events-none z-10"
          :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
        >
          {{ tooltip.text }}
        </div>

        <!-- Empty state -->
        <div
          v-if="!hasData"
          class="absolute inset-0 flex items-center justify-center"
        >
          <p class="text-muted-foreground text-base font-semibold">
            <span class="mr-1.5 text-base">📊</span>
            No activity data in this date range
          </p>
        </div>
      </div>

      <!-- Legend -->
      <div class="mt-4 flex items-center justify-center gap-3">
        <span class="text-xs text-muted-foreground font-medium">Less</span>
        <canvas ref="legendCanvas" width="200" height="20" class="rounded"></canvas>
        <span class="text-xs text-muted-foreground font-medium">More</span>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import type { Project } from '../types';
import { Card, CardContent } from './ui/card';

interface HeatmapCell {
  day: string;
  hour: number;
  count: number;
}

interface HeatmapData {
  cells: HeatmapCell[];
  maxCount: number;
}

const props = defineProps<{
  projects: Project[];
}>();

const canvas = ref<HTMLCanvasElement>();
const legendCanvas = ref<HTMLCanvasElement>();
const chartContainer = ref<HTMLDivElement>();
const canvasHeight = 600;
const selectedProject = ref<string>('all');
const heatmapData = ref<HeatmapData>({ cells: [], maxCount: 0 });
const loading = ref(false);

const tooltip = ref({
  visible: false,
  x: 0,
  y: 0,
  text: ''
});

let resizeObserver: ResizeObserver | null = null;

const hasData = computed(() => heatmapData.value.cells.length > 0);

const chartAriaLabel = computed(() => {
  const projectText = selectedProject.value === 'all' ? 'all projects' : selectedProject.value;
  return `Activity heatmap showing development activity across days and hours for ${projectText}`;
});

// Use HSL primary color from shadcn theme
const getThemePrimaryRGB = (): { r: number; g: number; b: number } => {
  const style = getComputedStyle(document.documentElement);
  const primaryHSL = style.getPropertyValue('--primary').trim();

  // shadcn uses HSL values like "222.2 47.4% 11.2%"
  if (primaryHSL) {
    // Create a temporary element to resolve the HSL to RGB
    const temp = document.createElement('div');
    temp.style.color = `hsl(${primaryHSL})`;
    document.body.appendChild(temp);
    const computed = getComputedStyle(temp).color;
    document.body.removeChild(temp);

    // Parse rgb(r, g, b) string
    const match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
    }
  }

  // Fallback to blue
  return { r: 59, g: 130, b: 246 };
};

// Fetch heatmap data from server
const fetchHeatmapData = async () => {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      days: '30'
    });

    if (selectedProject.value !== 'all') {
      params.append('project', selectedProject.value);
    }

    const response = await fetch(`http://localhost:4000/api/analytics/heatmap?${params}`);
    if (!response.ok) throw new Error('Failed to fetch heatmap data');

    heatmapData.value = await response.json();
    render();
  } catch (error) {
    console.error('Error fetching heatmap data:', error);
  } finally {
    loading.value = false;
  }
};

// Format hour in 12h format
const formatHour = (hour: number): string => {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
};

// Get abbreviated weekday name
const getWeekdayAbbr = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
};

// Get theme color for text/borders using CSS custom properties
const getThemeColor = (varName: string, fallback: string): string => {
  const style = getComputedStyle(document.documentElement);
  const value = style.getPropertyValue(varName).trim();
  if (value) {
    return `hsl(${value})`;
  }
  return fallback;
};

// Render the heatmap
const render = () => {
  if (!canvas.value || !chartContainer.value) return;

  const ctx = canvas.value.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = chartContainer.value.offsetWidth;
  const height = canvasHeight;

  canvas.value.width = width * dpr;
  canvas.value.height = height * dpr;
  canvas.value.style.width = `${width}px`;
  canvas.value.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Get unique days and sort them
  const days = Array.from(new Set(heatmapData.value.cells.map(c => c.day))).sort();
  const numDays = days.length || 30;
  const numHours = 24;

  // Calculate dimensions
  const leftPadding = 50;
  const rightPadding = 20;
  const topPadding = 30;
  const bottomPadding = 20;

  const chartWidth = width - leftPadding - rightPadding;
  const chartHeight = height - topPadding - bottomPadding;

  const cellWidth = chartWidth / numDays;
  const cellHeight = chartHeight / numHours;

  // Get theme color
  const primaryRGB = getThemePrimaryRGB();

  // Draw hour labels (Y-axis) - only show 12am, 6am, 12pm, 6pm
  ctx.fillStyle = getThemeColor('--muted-foreground', '#6b7280');
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  [0, 6, 12, 18].forEach(hour => {
    const y = topPadding + (hour * cellHeight) + (cellHeight / 2);
    ctx.fillText(formatHour(hour), leftPadding - 5, y);
  });

  // Draw day labels (X-axis) - show every nth day based on width
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const labelInterval = Math.max(1, Math.floor(numDays / 15)); // Show ~15 labels max
  days.forEach((day, index) => {
    if (index % labelInterval === 0 || index === days.length - 1) {
      const x = leftPadding + (index * cellWidth) + (cellWidth / 2);
      const weekday = getWeekdayAbbr(day);
      const dayNum = new Date(day + 'T00:00:00').getDate();
      ctx.fillText(`${weekday} ${dayNum}`, x, topPadding - 20);
    }
  });

  // Create a map for quick lookup
  const cellMap = new Map<string, number>();
  heatmapData.value.cells.forEach(cell => {
    cellMap.set(`${cell.day}-${cell.hour}`, cell.count);
  });

  // Draw cells
  days.forEach((day, dayIndex) => {
    for (let hour = 0; hour < numHours; hour++) {
      const count = cellMap.get(`${day}-${hour}`) || 0;
      const x = leftPadding + (dayIndex * cellWidth);
      const y = topPadding + (hour * cellHeight);

      // Calculate color intensity
      const opacity = heatmapData.value.maxCount > 0 ? count / heatmapData.value.maxCount : 0;

      // Draw cell with theme primary color
      ctx.fillStyle = `rgba(${primaryRGB.r}, ${primaryRGB.g}, ${primaryRGB.b}, ${opacity})`;
      ctx.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);

      // Draw cell border
      ctx.strokeStyle = getThemeColor('--border', '#e5e7eb');
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    }
  });

  // Render legend
  renderLegend();
};

// Render color scale legend
const renderLegend = () => {
  if (!legendCanvas.value) return;

  const ctx = legendCanvas.value.getContext('2d');
  if (!ctx) return;

  const width = 200;
  const height = 20;
  const primaryRGB = getThemePrimaryRGB();

  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, width, 0);

  for (let i = 0; i <= 10; i++) {
    const opacity = i / 10;
    gradient.addColorStop(i / 10, `rgba(${primaryRGB.r}, ${primaryRGB.g}, ${primaryRGB.b}, ${opacity})`);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Draw border
  ctx.strokeStyle = getThemeColor('--border', '#e5e7eb');
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, height);
};

// Handle mouse move for tooltip
const handleMouseMove = (event: MouseEvent) => {
  if (!canvas.value || !chartContainer.value) return;

  const rect = canvas.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const days = Array.from(new Set(heatmapData.value.cells.map(c => c.day))).sort();
  const numDays = days.length || 30;

  const leftPadding = 50;
  const rightPadding = 20;
  const topPadding = 30;
  const bottomPadding = 20;

  const chartWidth = chartContainer.value.offsetWidth - leftPadding - rightPadding;
  const chartHeight = canvasHeight - topPadding - bottomPadding;

  const cellWidth = chartWidth / numDays;
  const cellHeight = chartHeight / 24;

  // Check if mouse is within chart area
  if (x < leftPadding || x > leftPadding + chartWidth || y < topPadding || y > topPadding + chartHeight) {
    tooltip.value.visible = false;
    return;
  }

  // Calculate cell position
  const dayIndex = Math.floor((x - leftPadding) / cellWidth);
  const hour = Math.floor((y - topPadding) / cellHeight);

  if (dayIndex >= 0 && dayIndex < days.length && hour >= 0 && hour < 24) {
    const day = days[dayIndex];
    const count = heatmapData.value.cells.find(c => c.day === day && c.hour === hour)?.count || 0;

    const hourEnd = (hour + 1) % 24;
    const weekday = getWeekdayAbbr(day);
    const dayNum = new Date(day + 'T00:00:00').getDate();

    tooltip.value = {
      visible: true,
      x: event.clientX - rect.left + 10,
      y: event.clientY - rect.top - 40,
      text: `${weekday} ${dayNum}, ${formatHour(hour)}-${formatHour(hourEnd)}: ${count} events`
    };
  } else {
    tooltip.value.visible = false;
  }
};

// Handle mouse leave
const handleMouseLeave = () => {
  tooltip.value.visible = false;
};

// Handle resize
const handleResize = () => {
  render();
};

// Watch for project changes
watch(() => props.projects, () => {
  // If selected project no longer exists, reset to all
  if (selectedProject.value !== 'all' && !props.projects.find(p => p.name === selectedProject.value)) {
    selectedProject.value = 'all';
  }
});

// Watch for theme changes
const themeObserver = new MutationObserver(() => {
  render();
});

onMounted(() => {
  if (!canvas.value || !chartContainer.value) return;

  // Initial data fetch
  fetchHeatmapData();

  // Set up resize observer
  resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(chartContainer.value);

  // Observe theme changes
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  });
});

onUnmounted(() => {
  if (resizeObserver && chartContainer.value) {
    resizeObserver.disconnect();
  }
  themeObserver.disconnect();
});
</script>
