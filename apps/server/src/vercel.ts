/**
 * Vercel Deployment Status Integration
 *
 * Polls Vercel API for deployment status and caches results in-memory.
 * Updates are written to projects.deployment_status column and broadcast via WebSocket.
 */

import { Database } from 'bun:sqlite';

export interface DeploymentStatus {
  state: string;
  url: string;
  commit_message: string;
  created: number;
  vercel_project_id: string;
}

interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  created: number;
  state: 'BUILDING' | 'READY' | 'ERROR' | 'QUEUED' | 'CANCELED';
  meta?: {
    githubCommitMessage?: string;
  };
}

interface VercelApiResponse {
  deployments: VercelDeployment[];
}

let db: Database;
let pollingInterval: Timer | null = null;
let vercelToken: string = '';
let vercelProjects: Record<string, string> = {}; // project name -> vercel project id
let teamId: string = '';

// In-memory cache of deployment statuses
const deploymentCache = new Map<string, DeploymentStatus>();

/**
 * Initialize the Vercel poller.
 * Reads VERCEL_API_TOKEN and VERCEL_PROJECTS from environment.
 * Starts polling interval if configured.
 */
export function initVercelPoller(database: Database, options?: { skipInitialDelay?: boolean }): void {
  db = database;

  // Read environment variables
  vercelToken = process.env.VERCEL_API_TOKEN || '';
  const vercelProjectsJson = process.env.VERCEL_PROJECTS || '';
  teamId = process.env.VERCEL_TEAM_ID || '';

  if (!vercelToken) {
    console.log('[Vercel] No VERCEL_API_TOKEN found, deployment status disabled');
    return;
  }

  try {
    vercelProjects = JSON.parse(vercelProjectsJson);
  } catch {
    console.log('[Vercel] Invalid VERCEL_PROJECTS JSON, deployment status disabled');
    return;
  }

  if (Object.keys(vercelProjects).length === 0) {
    console.log('[Vercel] No projects configured in VERCEL_PROJECTS, deployment status disabled');
    return;
  }

  console.log(`[Vercel] Initialized with ${Object.keys(vercelProjects).length} project(s)`);

  // Initial poll (configurable delay for testing)
  const initialDelay = options?.skipInitialDelay ? 100 : 5000;
  setTimeout(() => {
    pollVercelDeployments().catch(err => console.error('[Vercel] Initial poll error:', err));
  }, initialDelay);

  // Poll every 30 seconds
  pollingInterval = setInterval(() => {
    pollVercelDeployments().catch(err => console.error('[Vercel] Poll error:', err));
  }, 30000);
}

/**
 * Poll Vercel API for latest deployments for all configured projects.
 * Updates deployment_status in the database and in-memory cache.
 */
export async function pollVercelDeployments(): Promise<void> {
  if (!vercelToken || Object.keys(vercelProjects).length === 0) {
    return;
  }

  const promises = Object.entries(vercelProjects).map(async ([projectName, vercelProjectId]) => {
    try {
      const status = await fetchLatestDeployment(vercelProjectId);
      if (status) {
        status.vercel_project_id = vercelProjectId;
        deploymentCache.set(projectName, status);
        updateProjectDeploymentStatus(projectName, status);
      }
    } catch (error) {
      console.error(`[Vercel] Error fetching deployment for ${projectName}:`, error);
    }
  });

  await Promise.allSettled(promises);
}

/**
 * Fetch the latest deployment for a Vercel project.
 * Returns null on error or if no deployments found.
 */
async function fetchLatestDeployment(projectId: string): Promise<DeploymentStatus | null> {
  try {
    let url = `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`;
    if (teamId) {
      url += `&teamId=${teamId}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
      },
    });

    if (!response.ok) {
      // Handle rate limiting, auth errors gracefully
      if (response.status === 401 || response.status === 403) {
        console.error(`[Vercel] Authentication error (${response.status})`);
        return null;
      }
      if (response.status === 429) {
        console.error('[Vercel] Rate limit exceeded');
        return null;
      }
      console.error(`[Vercel] API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as VercelApiResponse;

    if (!data.deployments || data.deployments.length === 0) {
      return null;
    }

    const deployment = data.deployments[0];
    if (!deployment) {
      return null;
    }

    return {
      state: deployment.state,
      url: deployment.url,
      commit_message: deployment.meta?.githubCommitMessage || '',
      created: deployment.created,
      vercel_project_id: projectId,
    };
  } catch (error) {
    console.error('[Vercel] Fetch error:', error);
    return null;
  }
}

/**
 * Update the deployment_status column for a project in the database.
 */
function updateProjectDeploymentStatus(projectName: string, status: DeploymentStatus): void {
  try {
    const statusJson = JSON.stringify(status);
    db.prepare('UPDATE projects SET deployment_status = ?, updated_at = ? WHERE name = ?')
      .run(statusJson, Date.now(), projectName);
  } catch (error) {
    console.error(`[Vercel] Error updating DB for ${projectName}:`, error);
  }
}

/**
 * Get cached deployment status for a project.
 * Returns null if not found or not configured.
 */
export function getDeploymentStatus(projectName: string): DeploymentStatus | null {
  return deploymentCache.get(projectName) || null;
}

/**
 * Stop the polling interval (for cleanup/testing).
 */
export function stopVercelPoller(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  // Clear cache
  deploymentCache.clear();
  // Reset config
  vercelToken = '';
  vercelProjects = {};
  teamId = '';
}
