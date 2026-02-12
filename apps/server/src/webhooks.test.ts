import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { triggerWebhooks, testWebhook } from './webhooks';
import type { HookEvent, Webhook } from './types';

describe('Webhook Module', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT DEFAULT '',
        event_types TEXT NOT NULL DEFAULT '[]',
        project_filter TEXT DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_triggered_at INTEGER,
        last_status INTEGER,
        last_error TEXT,
        trigger_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe('triggerWebhooks', () => {
    it('should trigger active webhooks matching event type', async () => {
      const webhook: Webhook = {
        id: 'test-webhook-1',
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        event_types: JSON.stringify(['SessionStart']),
        project_filter: '',
        active: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_triggered_at: null,
        last_status: null,
        last_error: null,
        trigger_count: 0,
        failure_count: 0
      };

      const stmt = db.prepare(`
        INSERT INTO webhooks (id, name, url, secret, event_types, project_filter, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        webhook.id,
        webhook.name,
        webhook.url,
        webhook.secret,
        webhook.event_types,
        webhook.project_filter,
        webhook.active,
        webhook.created_at,
        webhook.updated_at
      );

      const event: HookEvent = {
        source_app: 'TestProject',
        session_id: 'test-session-1',
        hook_event_type: 'SessionStart',
        payload: { test: true },
        timestamp: Date.now()
      };

      // This will fail to deliver but should not throw
      await triggerWebhooks(db, event);

      // Wait a bit for fire-and-forget delivery to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that webhook stats were updated (though delivery failed)
      const updated = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(webhook.id) as Webhook;
      expect(updated.trigger_count).toBe(1);
      expect(updated.failure_count).toBe(1);
    });

    it('should not trigger inactive webhooks', async () => {
      const webhook: Webhook = {
        id: 'test-webhook-2',
        name: 'Inactive Webhook',
        url: 'https://example.com/webhook',
        secret: '',
        event_types: JSON.stringify([]),
        project_filter: '',
        active: 0, // Inactive
        created_at: Date.now(),
        updated_at: Date.now(),
        last_triggered_at: null,
        last_status: null,
        last_error: null,
        trigger_count: 0,
        failure_count: 0
      };

      const stmt = db.prepare(`
        INSERT INTO webhooks (id, name, url, secret, event_types, project_filter, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        webhook.id,
        webhook.name,
        webhook.url,
        webhook.secret,
        webhook.event_types,
        webhook.project_filter,
        webhook.active,
        webhook.created_at,
        webhook.updated_at
      );

      const event: HookEvent = {
        source_app: 'TestProject',
        session_id: 'test-session-2',
        hook_event_type: 'SessionStart',
        payload: { test: true },
        timestamp: Date.now()
      };

      await triggerWebhooks(db, event);

      // Webhook should not be triggered
      const updated = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(webhook.id) as Webhook;
      expect(updated.trigger_count).toBe(0);
    });

    it('should filter by event type', async () => {
      const webhook: Webhook = {
        id: 'test-webhook-3',
        name: 'Filtered Webhook',
        url: 'https://example.com/webhook',
        secret: '',
        event_types: JSON.stringify(['SessionStop']), // Only SessionStop
        project_filter: '',
        active: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_triggered_at: null,
        last_status: null,
        last_error: null,
        trigger_count: 0,
        failure_count: 0
      };

      const stmt = db.prepare(`
        INSERT INTO webhooks (id, name, url, secret, event_types, project_filter, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        webhook.id,
        webhook.name,
        webhook.url,
        webhook.secret,
        webhook.event_types,
        webhook.project_filter,
        webhook.active,
        webhook.created_at,
        webhook.updated_at
      );

      const event: HookEvent = {
        source_app: 'TestProject',
        session_id: 'test-session-3',
        hook_event_type: 'SessionStart', // Different event type
        payload: { test: true },
        timestamp: Date.now()
      };

      await triggerWebhooks(db, event);

      // Webhook should not be triggered
      const updated = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(webhook.id) as Webhook;
      expect(updated.trigger_count).toBe(0);
    });

    it('should filter by project', async () => {
      const webhook: Webhook = {
        id: 'test-webhook-4',
        name: 'Project Filtered Webhook',
        url: 'https://example.com/webhook',
        secret: '',
        event_types: JSON.stringify([]),
        project_filter: 'SpecificProject', // Only this project
        active: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_triggered_at: null,
        last_status: null,
        last_error: null,
        trigger_count: 0,
        failure_count: 0
      };

      const stmt = db.prepare(`
        INSERT INTO webhooks (id, name, url, secret, event_types, project_filter, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        webhook.id,
        webhook.name,
        webhook.url,
        webhook.secret,
        webhook.event_types,
        webhook.project_filter,
        webhook.active,
        webhook.created_at,
        webhook.updated_at
      );

      const event: HookEvent = {
        source_app: 'DifferentProject', // Different project
        session_id: 'test-session-4',
        hook_event_type: 'SessionStart',
        payload: { test: true },
        timestamp: Date.now()
      };

      await triggerWebhooks(db, event);

      // Webhook should not be triggered
      const updated = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(webhook.id) as Webhook;
      expect(updated.trigger_count).toBe(0);
    });
  });

  describe('testWebhook', () => {
    it('should return failure for invalid URL', async () => {
      const webhook: Webhook = {
        id: 'test-webhook-5',
        name: 'Invalid URL Webhook',
        url: 'http://invalid-domain-that-does-not-exist-12345.com/webhook',
        secret: 'test-secret',
        event_types: JSON.stringify([]),
        project_filter: '',
        active: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_triggered_at: null,
        last_status: null,
        last_error: null,
        trigger_count: 0,
        failure_count: 0
      };

      const result = await testWebhook(webhook);

      expect(result.success).toBe(false);
      expect(result.status).toBe(0);
      expect(result.error).toBeDefined();
    });
  });
});
