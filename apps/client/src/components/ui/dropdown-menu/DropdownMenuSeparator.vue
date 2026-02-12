<script setup lang="ts">
import { DropdownMenuSeparator as Separator } from 'radix-vue'
import { cn } from '../../../lib/utils'

const props = defineProps<{ class?: string }>()
</script>
<template>
  <Separator :class="cn('-mx-1 my-1 h-px bg-muted', props.class)" />
</template>
