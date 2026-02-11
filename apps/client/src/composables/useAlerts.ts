import { ref, computed, type Ref } from 'vue';
import type { Alert } from './useWebSocket';

const SUPPRESS_DURATION_MS = 10 * 60 * 1000; // 10 minutes

interface DismissedAlertRecord {
  dismissedAt: number;
}

// Store dismissed alerts with timestamp
const dismissedAlerts = ref<Map<string, DismissedAlertRecord>>(new Map());

/**
 * Composable for managing alert dismiss state with TTL suppression
 */
export function useAlerts(alerts: Ref<Alert[]>) {
  /**
   * Dismiss an alert by ID
   */
  const dismissAlert = (alertId: string) => {
    dismissedAlerts.value.set(alertId, {
      dismissedAt: Date.now(),
    });
  };

  /**
   * Check if an alert is currently dismissed (within suppression window)
   */
  const isAlertDismissed = (alertId: string): boolean => {
    const record = dismissedAlerts.value.get(alertId);
    if (!record) return false;

    const now = Date.now();
    const elapsed = now - record.dismissedAt;

    // If suppression period has expired, remove from map
    if (elapsed > SUPPRESS_DURATION_MS) {
      dismissedAlerts.value.delete(alertId);
      return false;
    }

    return true;
  };

  /**
   * Active alerts (not dismissed or suppression expired)
   */
  const activeAlerts = computed(() => {
    // Clean up expired dismissals
    const now = Date.now();
    for (const [id, record] of dismissedAlerts.value.entries()) {
      if (now - record.dismissedAt > SUPPRESS_DURATION_MS) {
        dismissedAlerts.value.delete(id);
      }
    }

    // Filter out dismissed alerts
    return alerts.value.filter(alert => !isAlertDismissed(alert.id));
  });

  /**
   * Count of active alerts
   */
  const activeAlertCount = computed(() => activeAlerts.value.length);

  return {
    dismissAlert,
    isAlertDismissed,
    activeAlerts,
    activeAlertCount,
  };
}
