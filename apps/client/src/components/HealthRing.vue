<template>
  <div class="relative inline-flex items-center justify-center">
    <!-- SVG Ring -->
    <svg
      :width="size"
      :height="size"
      class="transform -rotate-90"
      :class="{ 'w-8 h-8': size === 32, 'w-10 h-10': size === 40 }"
    >
      <!-- Background circle -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="strokeWidth"
        class="fill-none stroke-[var(--theme-border-secondary)]"
      />
      <!-- Progress circle -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="strokeWidth"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        class="fill-none transition-all duration-500 ease-out"
        :class="ringColor"
        stroke-linecap="round"
      />
    </svg>

    <!-- Score text (centered inside ring) -->
    <div
      class="absolute inset-0 flex items-center justify-center text-[var(--theme-text-primary)] font-semibold transition-colors duration-300"
      :class="{ 'text-[9px]': size === 32, 'text-[11px]': size === 40 }"
    >
      {{ score }}
    </div>

    <!-- Trend arrow (positioned to the right of the ring) -->
    <span
      v-if="trend !== 'stable'"
      class="absolute transition-opacity duration-300"
      :class="trendClass"
      :style="trendPosition"
    >
      {{ trendIcon }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  score: number;
  trend?: 'improving' | 'declining' | 'stable';
  size?: 32 | 40;
}>(), {
  trend: 'stable',
  size: 40
});

const center = computed(() => props.size / 2);
const radius = computed(() => (props.size - 6) / 2); // Leave space for stroke
const strokeWidth = computed(() => props.size === 32 ? 3 : 4);
const circumference = computed(() => 2 * Math.PI * radius.value);

// Calculate dash offset to show progress
const dashOffset = computed(() => {
  const progress = Math.max(0, Math.min(100, props.score)) / 100;
  return circumference.value * (1 - progress);
});

// Color based on score ranges
const ringColor = computed(() => {
  if (props.score >= 80) {
    return 'stroke-green-500';
  } else if (props.score >= 50) {
    return 'stroke-amber-500';
  } else {
    return 'stroke-red-500';
  }
});

// Trend icon
const trendIcon = computed(() => {
  switch (props.trend) {
    case 'improving':
      return '↑';
    case 'declining':
      return '↓';
    default:
      return '—';
  }
});

// Trend color
const trendClass = computed(() => {
  switch (props.trend) {
    case 'improving':
      return 'text-green-600 text-xs';
    case 'declining':
      return 'text-red-600 text-xs';
    default:
      return 'text-[var(--theme-text-quaternary)] text-xs';
  }
});

// Trend position (to the right of the ring)
const trendPosition = computed(() => {
  const offset = props.size === 32 ? '26px' : '32px';
  return {
    left: offset,
    top: '50%',
    transform: 'translateY(-50%)'
  };
});
</script>
