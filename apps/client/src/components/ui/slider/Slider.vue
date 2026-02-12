<script setup lang="ts">
import { cn } from '../../../lib/utils'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  class?: string
  modelValue?: number
  min?: number
  max?: number
  step?: number
}>(), {
  modelValue: 50,
  min: 0,
  max: 100,
  step: 1
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const percentage = computed(() => {
  return ((props.modelValue - props.min) / (props.max - props.min)) * 100
})
</script>
<template>
  <div :class="cn('relative flex w-full touch-none select-none items-center', props.class)">
    <div class="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <div class="absolute h-full bg-primary" :style="{ width: percentage + '%' }" />
    </div>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    />
  </div>
</template>
