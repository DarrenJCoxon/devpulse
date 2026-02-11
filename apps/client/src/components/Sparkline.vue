<template>
  <svg :width="width" :height="height" class="inline-block">
    <g v-if="timeline.length > 0">
      <rect
        v-for="(point, index) in scaledPoints"
        :key="index"
        :x="point.x"
        :y="point.y"
        :width="barWidth"
        :height="point.height"
        :fill="barColor"
        class="transition-all"
      />
    </g>
    <text
      v-if="timeline.length === 0"
      :x="width / 2"
      :y="height / 2"
      text-anchor="middle"
      class="text-xs fill-[var(--theme-text-tertiary)]"
    >
      No data
    </text>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface TimelinePoint {
  minute: number;
  events: number;
}

interface Props {
  timeline: TimelinePoint[];
  width?: number;
  height?: number;
  barColor?: string;
}

const props = withDefaults(defineProps<Props>(), {
  width: 60,
  height: 24,
  barColor: 'var(--theme-primary)'
});

// Calculate bar width and gap
const barWidth = computed(() => {
  if (props.timeline.length === 0) return 0;
  const totalWidth = props.width;
  const gap = 1;
  return Math.max(1, (totalWidth - (props.timeline.length - 1) * gap) / props.timeline.length);
});

// Scale points to fit in SVG
const scaledPoints = computed(() => {
  if (props.timeline.length === 0) return [];

  const maxEvents = Math.max(...props.timeline.map(p => p.events), 1);
  const gap = 1;

  return props.timeline.map((point, index) => {
    const barHeight = (point.events / maxEvents) * (props.height - 2); // Leave 2px padding
    const x = index * (barWidth.value + gap);
    const y = props.height - barHeight;

    return {
      x,
      y,
      height: barHeight,
      width: barWidth.value
    };
  });
});
</script>
