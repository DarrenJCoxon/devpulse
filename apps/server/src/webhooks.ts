import type { Database } from 'bun:sqlite';
import type { HookEvent, Webhook } from './types';

/**
 * Validate a webhook URL for safety.
 * Blocks private/internal IPs (SSRF prevention) and requires https:// or http://localhost.
 */
export function validateWebhookUrl(urlStr: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Must be http or https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'URL must use http or https protocol' };
  }

  const hostname = parsed.hostname;

  // Allow http only for localhost
  if (parsed.protocol === 'http:') {
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
      return { valid: false, error: 'Non-localhost URLs must use https' };
    }
  }

  // Block private/internal IP ranges (SSRF prevention)
  const privatePatterns = [
    /^127\./,                                    // 127.0.0.0/8
    /^10\./,                                     // 10.0.0.0/8
    /^192\.168\./,                               // 192.168.0.0/16
    /^172\.(1[6-9]|2\d|3[0-1])\./,             // 172.16.0.0/12
    /^169\.254\./,                               // 169.254.0.0/16 (link-local)
    /^0\./,                                      // 0.0.0.0/8
  ];

  // Only block private IPs for non-localhost URLs
  if (hostname !== 'localhost' && hostname !== '::1') {
    for (const pattern of privatePatterns) {
      if (pattern.test(hostname)) {
        return { valid: false, error: 'Webhook URLs must not point to private/internal IP addresses' };
      }
    }
  }

  return { valid: true };
}

/**
 * Create HMAC-SHA256 signature for webhook payload
 */
function createHmacSignature(payload: string, secret: string): string {
  if (!secret) return '';
  const hmac = new Bun.CryptoHasher('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Update webhook status after delivery attempt
 */
function updateWebhookStatus(
  db: Database,
  id: string,
  status: number,
  error: string | null
): void {
  const now = Date.now();
  const incrementFailure = error ? 1 : 0;

  const stmt = db.prepare(`
    UPDATE webhooks
    SET last_triggered_at = ?,
        last_status = ?,
        last_error = ?,
        trigger_count = trigger_count + 1,
        failure_count = failure_count + ?,
        updated_at = ?
    WHERE id = ?
  `);

  stmt.run(now, status, error, incrementFailure, now, id);
}

/**
 * Deliver webhook to target URL
 */
async function deliverWebhook(
  db: Database,
  webhook: Webhook,
  event: HookEvent
): Promise<void> {
  const payload = JSON.stringify({
    event_type: event.hook_event_type,
    source_app: event.source_app,
    session_id: event.session_id,
    timestamp: event.timestamp,
    payload: event.payload,
    summary: event.summary
  });

  const signature = createHmacSignature(payload, webhook.secret);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DevPulse-Event': event.hook_event_type,
        'X-DevPulse-Signature': signature ? `sha256=${signature}` : '',
        'User-Agent': 'DevPulse-Webhook/1.0'
      },
      body: payload,
      signal: AbortSignal.timeout(5000)
    });

    // Update webhook stats
    updateWebhookStatus(
      db,
      webhook.id,
      response.status,
      response.ok ? null : response.statusText
    );
  } catch (error: any) {
    // Update webhook with error
    const errorMessage = error.message || 'Unknown error';
    updateWebhookStatus(db, webhook.id, 0, errorMessage);
    throw error;
  }
}

/**
 * Trigger webhooks for an event (fire and forget)
 */
export async function triggerWebhooks(
  db: Database,
  event: HookEvent
): Promise<void> {
  const webhooks = db.prepare(`
    SELECT id, name, url, secret, event_types, project_filter, active
    FROM webhooks
    WHERE active = 1
  `).all() as Webhook[];

  for (const webhook of webhooks) {
    const eventTypes: string[] = JSON.parse(webhook.event_types || '[]');

    // Check event type filter
    if (eventTypes.length > 0 && !eventTypes.includes(event.hook_event_type)) continue;

    // Check project filter
    if (webhook.project_filter && event.source_app !== webhook.project_filter) continue;

    // Fire and forget (with error handling)
    deliverWebhook(db, webhook, event).catch(err => {
      console.error(`[Webhook] Failed to deliver to ${webhook.url}:`, err);
    });
  }
}

/**
 * Test webhook by sending a test payload
 */
export async function testWebhook(webhook: Webhook): Promise<{
  success: boolean;
  status: number;
  error?: string;
}> {
  const testPayload = JSON.stringify({
    event_type: 'TestWebhook',
    source_app: 'DevPulse',
    session_id: 'test-' + Date.now(),
    timestamp: Date.now(),
    payload: { message: 'Test webhook from DevPulse' },
    summary: 'Test webhook delivery'
  });

  const signature = createHmacSignature(testPayload, webhook.secret);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DevPulse-Event': 'TestWebhook',
        'X-DevPulse-Signature': signature ? `sha256=${signature}` : '',
        'User-Agent': 'DevPulse-Webhook/1.0'
      },
      body: testPayload,
      signal: AbortSignal.timeout(5000)
    });

    return {
      success: response.ok,
      status: response.status,
      error: response.ok ? undefined : response.statusText
    };
  } catch (error: any) {
    return {
      success: false,
      status: 0,
      error: error.message || 'Request failed'
    };
  }
}
