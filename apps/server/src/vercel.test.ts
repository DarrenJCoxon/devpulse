import { test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initVercelPoller, pollVercelDeployments, getDeploymentStatus, stopVercelPoller } from './vercel';

// Mock environment setup
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

beforeEach(() => {
  // Reset environment before each test
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

afterEach(() => {
  // Cleanup
  stopVercelPoller();
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

test('initVercelPoller - should not start polling when VERCEL_API_TOKEN is missing', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);

  delete process.env.VERCEL_API_TOKEN;
  process.env.VERCEL_PROJECTS = '{"TestProject":"prj_123"}';

  // Should not throw, just log and skip
  initVercelPoller(db);

  // No deployment status should be set (project doesn't exist, so result is null)
  const project = db.prepare('SELECT deployment_status FROM projects WHERE name = ?').get('TestProject') as any;
  expect(project).toBeNull();

  db.close();
});

test('initVercelPoller - should not start polling when VERCEL_PROJECTS is invalid JSON', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);

  process.env.VERCEL_API_TOKEN = 'test_token';
  process.env.VERCEL_PROJECTS = 'invalid json';

  // Should not throw, just log and skip
  initVercelPoller(db);

  db.close();
});

test('initVercelPoller - should not start polling when VERCEL_PROJECTS is empty', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);

  process.env.VERCEL_API_TOKEN = 'test_token';
  process.env.VERCEL_PROJECTS = '{}';

  // Should not throw, just log and skip
  initVercelPoller(db);

  db.close();
});

test('pollVercelDeployments - should handle successful API response', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);
  db.prepare('INSERT INTO projects (name, deployment_status, updated_at) VALUES (?, ?, ?)').run('TestProject', '', Date.now());

  process.env.VERCEL_API_TOKEN = 'test_token';
  process.env.VERCEL_PROJECTS = '{"TestProject":"prj_123"}';

  // Mock fetch to return successful deployment
  const mockFetch = mock((url: string, options?: any) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        deployments: [
          {
            uid: 'dpl_123',
            name: 'test-deployment',
            url: 'test-deployment.vercel.app',
            created: Date.now(),
            state: 'READY',
            meta: {
              githubCommitMessage: 'fix: test commit',
            },
          },
        ],
      }),
    });
  });

  global.fetch = mockFetch as any;

  initVercelPoller(db, { skipInitialDelay: true });

  // Wait for initial poll to complete
  await new Promise(resolve => setTimeout(resolve, 200));

  // Should call fetch with correct URL and headers
  expect(mockFetch).toHaveBeenCalled();

  // Check that deployment status was cached
  const status = getDeploymentStatus('TestProject');
  expect(status).not.toBeNull();
  expect(status?.state).toBe('READY');
  expect(status?.url).toBe('test-deployment.vercel.app');
  expect(status?.commit_message).toBe('fix: test commit');

  db.close();
});

test('pollVercelDeployments - should handle 401 authentication error gracefully', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);

  process.env.VERCEL_API_TOKEN = 'invalid_token';
  process.env.VERCEL_PROJECTS = '{"TestProject":"prj_123"}';

  // Mock fetch to return 401
  const mockFetch = mock(() => {
    return Promise.resolve({
      ok: false,
      status: 401,
    });
  });

  global.fetch = mockFetch as any;

  initVercelPoller(db, { skipInitialDelay: true });

  // Wait for poll to complete
  await new Promise(resolve => setTimeout(resolve, 200));

  // Should not throw, and no status should be cached
  const status = getDeploymentStatus('TestProject');
  expect(status).toBeNull();

  db.close();
});

test('pollVercelDeployments - should handle 429 rate limit error gracefully', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);

  process.env.VERCEL_API_TOKEN = 'test_token';
  process.env.VERCEL_PROJECTS = '{"TestProject":"prj_123"}';

  // Mock fetch to return 429
  const mockFetch = mock(() => {
    return Promise.resolve({
      ok: false,
      status: 429,
    });
  });

  global.fetch = mockFetch as any;

  initVercelPoller(db, { skipInitialDelay: true });

  // Wait for poll to complete
  await new Promise(resolve => setTimeout(resolve, 200));

  // Should not throw, and no status should be cached
  const status = getDeploymentStatus('TestProject');
  expect(status).toBeNull();

  db.close();
});

test('pollVercelDeployments - should parse BUILDING state correctly', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);
  db.prepare('INSERT INTO projects (name, deployment_status, updated_at) VALUES (?, ?, ?)').run('TestProject', '', Date.now());

  process.env.VERCEL_API_TOKEN = 'test_token';
  process.env.VERCEL_PROJECTS = '{"TestProject":"prj_123"}';

  // Mock fetch to return building deployment
  const mockFetch = mock(() => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        deployments: [
          {
            uid: 'dpl_123',
            name: 'test-deployment',
            url: 'test-deployment.vercel.app',
            created: Date.now(),
            state: 'BUILDING',
          },
        ],
      }),
    });
  });

  global.fetch = mockFetch as any;

  initVercelPoller(db, { skipInitialDelay: true });
  await new Promise(resolve => setTimeout(resolve, 200));

  const status = getDeploymentStatus('TestProject');
  expect(status?.state).toBe('BUILDING');

  db.close();
});

test('pollVercelDeployments - should parse ERROR state correctly', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT,
      deployment_status TEXT DEFAULT '',
      updated_at INTEGER
    )
  `);
  db.prepare('INSERT INTO projects (name, deployment_status, updated_at) VALUES (?, ?, ?)').run('TestProject', '', Date.now());

  process.env.VERCEL_API_TOKEN = 'test_token';
  process.env.VERCEL_PROJECTS = '{"TestProject":"prj_123"}';

  // Mock fetch to return error deployment
  const mockFetch = mock(() => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        deployments: [
          {
            uid: 'dpl_123',
            name: 'test-deployment',
            url: 'test-deployment.vercel.app',
            created: Date.now(),
            state: 'ERROR',
          },
        ],
      }),
    });
  });

  global.fetch = mockFetch as any;

  initVercelPoller(db, { skipInitialDelay: true });
  await new Promise(resolve => setTimeout(resolve, 200));

  const status = getDeploymentStatus('TestProject');
  expect(status?.state).toBe('ERROR');

  db.close();
});

test('getDeploymentStatus - should return null for unconfigured project', () => {
  const status = getDeploymentStatus('NonExistentProject');
  expect(status).toBeNull();
});
