<template>
  <div class="fixed top-16 right-4 mobile:right-2 z-50 bg-[var(--theme-bg-primary)] rounded-lg border border-[var(--theme-border-primary)] shadow-xl overflow-hidden w-80 mobile:w-[calc(100vw-1rem)]">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-[var(--theme-border-secondary)] flex items-center justify-between bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-primary-light)]">
      <div class="flex items-center gap-2">
        <span class="text-xl">🔔</span>
        <h3 class="text-base font-semibold text-white">Notification Settings</h3>
      </div>
      <button
        @click="$emit('close')"
        class="text-white hover:bg-white/20 rounded p-1 transition-colors"
        title="Close"
      >
        <span class="text-xl">✕</span>
      </button>
    </div>

    <!-- Body -->
    <div class="px-4 py-3 space-y-4">
      <!-- Permission status -->
      <div v-if="permissionStatus !== 'granted'" class="text-xs text-[var(--theme-text-tertiary)] bg-[var(--theme-bg-tertiary)] rounded px-3 py-2">
        <div v-if="permissionStatus === 'denied'" class="flex items-start gap-2">
          <span>⚠️</span>
          <div>
            <div class="font-medium text-[var(--theme-text-secondary)]">Notifications Blocked</div>
            <div class="mt-0.5">You have blocked notifications. Please enable them in your browser settings.</div>
          </div>
        </div>
        <div v-else-if="permissionStatus === 'default'" class="flex items-start gap-2">
          <span>ℹ️</span>
          <div>
            <div class="font-medium text-[var(--theme-text-secondary)]">Notifications Not Enabled</div>
            <div class="mt-0.5">Enable notifications below to receive alerts when agents need your attention.</div>
          </div>
        </div>
      </div>

      <div v-else class="text-xs text-green-600 bg-green-50 rounded px-3 py-2 flex items-center gap-2">
        <span>✅</span>
        <span class="font-medium">Notifications Enabled</span>
      </div>

      <!-- Enable/Disable toggle -->
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-[var(--theme-text-primary)]">Enable Notifications</div>
          <div class="text-xs text-[var(--theme-text-tertiary)] mt-0.5">
            Get notified when agents need attention
          </div>
        </div>
        <button
          @click="toggleEnabled"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          :class="settings.enabled ? 'bg-[var(--theme-primary)]' : 'bg-gray-300'"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            :class="settings.enabled ? 'translate-x-6' : 'translate-x-1'"
          ></span>
        </button>
      </div>

      <!-- Event type checkboxes -->
      <div v-if="settings.enabled" class="space-y-2">
        <div class="text-xs font-medium text-[var(--theme-text-secondary)] uppercase tracking-wide">
          Notify On
        </div>
        <label
          v-for="eventType in availableEventTypes"
          :key="eventType.value"
          class="flex items-start gap-2.5 cursor-pointer hover:bg-[var(--theme-bg-tertiary)] rounded px-2 py-1.5 transition-colors"
        >
          <input
            type="checkbox"
            :checked="settings.types.includes(eventType.value)"
            @change="toggleEventType(eventType.value)"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[var(--theme-primary)] focus:ring-[var(--theme-primary)]"
          />
          <div class="flex-1">
            <div class="text-sm font-medium text-[var(--theme-text-primary)]">
              {{ eventType.label }}
            </div>
            <div class="text-xs text-[var(--theme-text-tertiary)] mt-0.5">
              {{ eventType.description }}
            </div>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, type PropType } from 'vue';
import type { NotificationSettings } from '../types';

const props = defineProps({
  settings: {
    type: Object as PropType<NotificationSettings>,
    required: true
  },
  requestPermission: {
    type: Function as PropType<() => Promise<NotificationPermission>>,
    required: true
  }
});

defineEmits<{
  close: [];
}>();

const availableEventTypes = [
  {
    value: 'Notification',
    label: 'Agent Waiting',
    description: 'When an agent needs input or permission'
  },
  {
    value: 'Stop',
    label: 'Session Ended',
    description: 'When an agent session completes'
  },
  {
    value: 'PostToolUseFailure',
    label: 'Tool Failure',
    description: 'When a tool execution fails'
  }
];

// Track permission status
const permissionStatus = ref<NotificationPermission>(
  'Notification' in window ? Notification.permission : 'denied'
);

async function toggleEnabled() {
  if (!props.settings.enabled) {
    // Enabling: request permission first
    const permission = await props.requestPermission();
    permissionStatus.value = permission;

    if (permission === 'granted') {
      props.settings.enabled = true;
    }
  } else {
    // Disabling: just toggle off
    props.settings.enabled = false;
  }
}

function toggleEventType(eventType: string) {
  const index = props.settings.types.indexOf(eventType);
  if (index >= 0) {
    // Remove from array
    props.settings.types.splice(index, 1);
  } else {
    // Add to array
    props.settings.types.push(eventType);
  }
}
</script>
