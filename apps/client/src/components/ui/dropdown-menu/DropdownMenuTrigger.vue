<script setup lang="ts">
import { DropdownMenuTrigger as Trigger } from 'radix-vue'

const props = defineProps<{ asChild?: boolean }>()
</script>
<template>
  <Trigger :as-child="asChild">
    <slot />
  </Trigger>
</template>
