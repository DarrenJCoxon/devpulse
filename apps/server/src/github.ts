/**
 * GitHub Activity Integration
 *
 * Polls GitHub API for commit history, open PRs, and CI workflow status.
 * Updates are written to projects.github_status column and broadcast via WebSocket.
 */

import { Database } from 'bun:sqlite';

export interface GitHubStatus {
  repo: string;
  recent_commits: Array<{
    sha: string;
    message: string;
    author: string;
    date: number;
  }>;
  open_prs: Array<{
    number: number;
    title: string;
    author: string;
    draft: boolean;
    updated_at: number;
  }>;
  latest_run: {
    status: string;
    conclusion: string;
    name: string;
    html_url: string;
    created_at: number;
  } | null;
  last_polled: number;
}

let db: Database;
let pollingInterval: Timer | null = null;
let githubToken: string = '';
let githubRepos: Record<string, string> = {}; // project name -> owner/repo

// In-memory cache of GitHub statuses
const githubCache = new Map<string, GitHubStatus>();

/**
 * Initialize the GitHub poller.
 * Reads GITHUB_TOKEN and GITHUB_REPOS from environment.
 * Starts polling interval if configured.
 */
export function initGitHubPoller(database: Database): void {
  db = database;

  githubToken = process.env.GITHUB_TOKEN || '';
  const githubReposJson = process.env.GITHUB_REPOS || '';

  if (!githubToken) {
    console.log('[GitHub] No GITHUB_TOKEN found, GitHub integration disabled');
    return;
  }

  try {
    githubRepos = JSON.parse(githubReposJson);
  } catch {
    console.log('[GitHub] Invalid GITHUB_REPOS JSON, GitHub integration disabled');
    return;
  }

  if (Object.keys(githubRepos).length === 0) {
    console.log('[GitHub] No repos configured in GITHUB_REPOS, GitHub integration disabled');
    return;
  }

  console.log(`[GitHub] Initialized with ${Object.keys(githubRepos).length} project(s)`);

  // Initial poll after 5s delay
  setTimeout(() => {
    pollGitHubStatus().catch(err => console.error('[GitHub] Initial poll error:', err));
  }, 5000);

  // Poll every 30 seconds
  pollingInterval = setInterval(() => {
    pollGitHubStatus().catch(err => console.error('[GitHub] Poll error:', err));
  }, 30000);
}

/**
 * Poll GitHub API for all configured projects.
 */
async function pollGitHubStatus(): Promise<void> {
  if (!githubToken || Object.keys(githubRepos).length === 0) return;

  const promises = Object.entries(githubRepos).map(async ([projectName, repo]) => {
    try {
      const status = await fetchGitHubStatus(repo);
      if (status) {
        githubCache.set(projectName, status);
        updateProjectGitHubStatus(projectName, status);
      }
    } catch (error) {
      console.error(`[GitHub] Error fetching status for ${projectName}:`, error);
    }
  });

  await Promise.allSettled(promises);
}

/**
 * Fetch GitHub status for a single repo.
 * Makes three API calls: commits, PRs, and workflow runs.
 */
async function fetchGitHubStatus(repo: string): Promise<GitHubStatus | null> {
  const headers = {
    'Authorization': `Bearer ${githubToken}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    const [commitsRes, prsRes, runsRes] = await Promise.allSettled([
      fetch(`https://api.github.com/repos/${repo}/commits?per_page=5`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=5&sort=updated`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, { headers }),
    ]);

    // Check for auth/rate limit errors on any response
    for (const result of [commitsRes, prsRes, runsRes]) {
      if (result.status === 'fulfilled') {
        const res = result.value;
        if (res.status === 401 || res.status === 403) {
          console.error(`[GitHub] Authentication error (${res.status}) for ${repo}`);
          return null;
        }
        if (res.status === 429) {
          console.error(`[GitHub] Rate limit exceeded for ${repo}`);
          return null;
        }
      }
    }

    // Parse commits
    const recent_commits: GitHubStatus['recent_commits'] = [];
    if (commitsRes.status === 'fulfilled' && commitsRes.value.ok) {
      const commits = await commitsRes.value.json() as any[];
      for (const c of commits) {
        recent_commits.push({
          sha: c.sha?.slice(0, 7) || '',
          message: (c.commit?.message || '').split('\n')[0].slice(0, 120),
          author: c.commit?.author?.name || c.author?.login || '',
          date: c.commit?.author?.date ? new Date(c.commit.author.date).getTime() : 0,
        });
      }
    }

    // Parse PRs
    const open_prs: GitHubStatus['open_prs'] = [];
    if (prsRes.status === 'fulfilled' && prsRes.value.ok) {
      const prs = await prsRes.value.json() as any[];
      for (const pr of prs) {
        open_prs.push({
          number: pr.number,
          title: (pr.title || '').slice(0, 120),
          author: pr.user?.login || '',
          draft: pr.draft || false,
          updated_at: pr.updated_at ? new Date(pr.updated_at).getTime() : 0,
        });
      }
    }

    // Parse latest workflow run
    let latest_run: GitHubStatus['latest_run'] = null;
    if (runsRes.status === 'fulfilled' && runsRes.value.ok) {
      const data = await runsRes.value.json() as any;
      const runs = data.workflow_runs || [];
      if (runs.length > 0) {
        const run = runs[0];
        latest_run = {
          status: run.status || '',
          conclusion: run.conclusion || '',
          name: run.name || '',
          html_url: run.html_url || '',
          created_at: run.created_at ? new Date(run.created_at).getTime() : 0,
        };
      }
    }

    return {
      repo,
      recent_commits,
      open_prs,
      latest_run,
      last_polled: Date.now(),
    };
  } catch (error) {
    console.error(`[GitHub] Fetch error for ${repo}:`, error);
    return null;
  }
}

/**
 * Update the github_status column for a project in the database.
 */
function updateProjectGitHubStatus(projectName: string, status: GitHubStatus): void {
  try {
    const statusJson = JSON.stringify(status);
    db.prepare('UPDATE projects SET github_status = ?, updated_at = ? WHERE name = ?')
      .run(statusJson, Date.now(), projectName);
  } catch (error) {
    console.error(`[GitHub] Error updating DB for ${projectName}:`, error);
  }
}

/**
 * Get cached GitHub status for a project.
 */
export function getGitHubStatus(projectName: string): GitHubStatus | null {
  return githubCache.get(projectName) || null;
}

/**
 * Stop the polling interval (for cleanup/testing).
 */
export function stopGitHubPoller(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  githubCache.clear();
  githubToken = '';
  githubRepos = {};
}
