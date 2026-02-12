<script setup lang="ts">
import { DropdownMenuContent as Content, DropdownMenuPortal } from 'radix-vue'
import { cn } from '../../../lib/utils'

const props = withDefaults(defineProps<{
  class?: string
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}>(), {
  align: 'center',
  sideOffset: 4
})
</script>
<template>
  <DropdownMenuPortal>
    <Content
      :align="align"
      :side-offset="sideOffset"
      :class="cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        props.class
      )"
    >
      <slot />
    </Content>
  </DropdownMenuPortal>
</template>
