import { ref, watch, type Ref } from 'vue';
import type { HookEvent } from '../types';

export interface NotificationSettings {
  enabled: boolean;
  types: string[];
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  types: ['Notification']
};

const STORAGE_KEY = 'devpulse-notification-settings';

export function useNotifications(events: Ref<HookEvent[]>) {
  // Load settings from localStorage
  const settings = ref<NotificationSettings>(loadSettings());

  // Track last event count to detect new events
  let lastEventCount = events.value.length;

  // Save settings whenever they change
  watch(settings, (newSettings) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  }, { deep: true });

  // Watch for new events
  watch(events, (newEvents) => {
    // Only process if we have new events (not initial load)
    if (newEvents.length > lastEventCount) {
      const newEventsList = newEvents.slice(lastEventCount);
      lastEventCount = newEvents.length;

      // Process each new event
      newEventsList.forEach(event => {
        handleNewEvent(event);
      });
    } else {
      // Update counter even if events were removed
      lastEventCount = newEvents.length;
    }
  });

  function loadSettings(): NotificationSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  async function requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported');
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission;
    }

    return Notification.permission;
  }

  function sendNotification(title: string, body: string, tag: string): void {
    // Don't send if notifications are not supported
    if (!('Notification' in window)) {
      return;
    }

    // Don't send if permission not granted
    if (Notification.permission !== 'granted') {
      return;
    }

    // Don't send if tab is visible (user is already looking)
    if (!document.hidden) {
      return;
    }

    // Send the notification
    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag // Prevents duplicate notifications with same tag
    });

    // Focus the tab when notification is clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  function handleNewEvent(event: HookEvent): void {
    // Don't process if notifications are disabled
    if (!settings.value.enabled) {
      return;
    }

    // Don't process if this event type is not in enabled types
    if (!settings.value.types.includes(event.hook_event_type)) {
      return;
    }

    // Build notification content based on event type
    const agentId = `${event.source_app}:${event.session_id.slice(0, 8)}`;
    const projectName = event.payload?.project_name || 'Unknown Project';

    let title = 'DevPulse';
    let body = '';

    switch (event.hook_event_type) {
      case 'Notification':
        title = 'DevPulse: Agent Waiting';
        body = `${projectName} - ${agentId} is waiting for input`;
        if (event.payload?.notification_message) {
          body += `\n${event.payload.notification_message}`;
        }
        break;

      case 'Stop':
        title = 'DevPulse: Session Ended';
        body = `${projectName} - ${agentId} session completed`;
        break;

      case 'PostToolUseFailure':
        title = 'DevPulse: Tool Failure';
        const toolName = event.payload?.tool_name || 'unknown tool';
        body = `${projectName} - ${agentId} tool failure: ${toolName}`;
        break;

      default:
        return; // Unknown event type, don't send notification
    }

    // Use session_id as tag to prevent duplicate notifications for same session
    const tag = `devpulse-${event.session_id}`;

    sendNotification(title, body, tag);
  }

  return {
    settings,
    requestPermission,
    sendNotification
  };
}
