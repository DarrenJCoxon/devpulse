/**
 * plainEnglish.ts
 *
 * Core translation layer that turns raw DevPulse data into human-readable text.
 * Every public function handles null, undefined, and empty-string inputs gracefully.
 */

// ---------------------------------------------------------------------------
// Color palette -- 8 visually distinct HSL values that work on light and dark
// ---------------------------------------------------------------------------
const PROJECT_COLORS: string[] = [
  '210 100% 56%', // blue
  '340 82% 52%',  // rose
  '142 76% 36%',  // green
  '38 92% 50%',   // amber
  '262 83% 58%',  // violet
  '190 90% 50%',  // cyan
  '15 90% 55%',   // orange
  '330 81% 60%',  // pink
]

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function extractFilename(filePath: string | undefined | null): string {
  if (!filePath) return ''
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

function titleCase(str: string): string {
  return str
    .split(/[\s]+/)
    .map((w) => (w.length === 0 ? '' : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

/**
 * Convert agent_type slugs to friendly names.
 * "qa-validator" -> "QA Validator"
 * "story-implementer" -> "Story Implementer"
 * "security-red-team" -> "Security Red Team"
 */
function friendlyAgentType(agentType: string | undefined | null): string {
  if (!agentType) return ''

  const AGENT_NAMES: Record<string, string> = {
    'qa-validator': 'QA Validator',
    'story-implementer': 'Story Implementer',
    'story-qa-auditor': 'Story QA Auditor',
    'security-red-team': 'Security Red Team',
    'pre-ship-tester': 'Pre-Ship Tester',
    'ui-ux-optimizer': 'UI/UX Optimizer',
    'code-simplifier': 'Code Simplifier',
    'scrum-master': 'Scrum Master',
    'general-purpose': 'General Purpose Agent',
    'builder': 'Builder Agent',
    'validator': 'Validator Agent',
    'Explore': 'Explorer Agent',
    'Plan': 'Planning Agent',
    'Bash': 'Command Runner',
  }

  if (AGENT_NAMES[agentType]) return AGENT_NAMES[agentType]

  // Fallback: convert kebab-case to Title Case
  return titleCase(agentType.replace(/[-_]+/g, ' '))
}

// ---------------------------------------------------------------------------
// humanizeBranch
// ---------------------------------------------------------------------------

/**
 * Converts a git branch name to human-readable text.
 *
 * "feature/47.3-attendance-data-sync" -> "Attendance Data Sync"
 * "fix/login-bug"                     -> "Login Bug"
 * "main"                              -> "Main"
 * "develop"                           -> "Develop"
 */
export function humanizeBranch(branch: string): string {
  if (!branch) return ''

  // Strip common prefixes (feature/, fix/, hotfix/, bugfix/, release/, chore/, etc.)
  let cleaned = branch.replace(/^[a-zA-Z]+\//, '')

  // Strip leading ticket/version numbers like "47.3-" or "JIRA-123-"
  cleaned = cleaned.replace(/^[\d.]+[-_]/, '')
  cleaned = cleaned.replace(/^[A-Z]+-\d+[-_]/, '')

  // Replace delimiters with spaces
  cleaned = cleaned.replace(/[-_/]+/g, ' ')

  return titleCase(cleaned.trim()) || branch
}

// ---------------------------------------------------------------------------
// humanizeEvent
// ---------------------------------------------------------------------------

/**
 * Converts a hook event into a plain English description.
 */
export function humanizeEvent(event: {
  hook_event_type: string
  payload: Record<string, any>
}): string {
  if (!event) return ''

  const type = event.hook_event_type ?? ''
  const payload = event.payload ?? {}
  const toolName: string = payload.tool_name ?? ''
  const toolInput: Record<string, any> = payload.tool_input ?? {}

  // Non-tool event types
  switch (type) {
    case 'UserPromptSubmit':
      return 'Received new instructions'
    case 'Notification':
      return 'Waiting for your input'
    case 'Stop':
    case 'SessionEnd':
      return 'Session finished'
    case 'SubagentStart': {
      const agentName = friendlyAgentType(payload.agent_type)
      return agentName ? `${agentName} started` : 'Delegated work to a helper agent'
    }
    case 'SubagentStop': {
      const agentName = friendlyAgentType(payload.agent_type)
      return agentName ? `${agentName} finished` : 'Helper agent finished its task'
    }
    case 'PreCompact':
      return 'Compressing conversation to free up memory'
    case 'SessionStart':
      return 'Session started'
    case 'PermissionRequest':
      return 'Requesting permission'
  }

  // PostToolUseFailure
  if (type === 'PostToolUseFailure') {
    if (toolName === 'Bash') return 'A command failed'
    if (toolName === 'Edit' || toolName === 'Write') return 'File edit failed'
    return 'Something went wrong, retrying'
  }

  // Tool-based events (PreToolUse / PostToolUse)
  if (type === 'PreToolUse' || type === 'PostToolUse') {
    const past = type === 'PostToolUse'
    return describeToolUse(toolName, toolInput, past)
  }

  // Fallback: return the raw event type
  return type || 'Working'
}

/**
 * Build a human-readable description for a tool use event.
 */
function describeToolUse(
  toolName: string,
  toolInput: Record<string, any>,
  past: boolean,
): string {
  switch (toolName) {
    case 'Write': {
      const file = extractFilename(toolInput.file_path)
      const verb = past ? 'Created' : 'Creating'
      return file ? `${verb} ${file}` : `${verb} a new file`
    }

    case 'Edit': {
      const file = extractFilename(toolInput.file_path)
      const verb = past ? 'Edited' : 'Editing'
      return file ? `${verb} ${file}` : `${verb} a file`
    }

    case 'MultiEdit': {
      const file = extractFilename(toolInput.file_path)
      const verb = past ? 'Made multiple edits to' : 'Making multiple edits to'
      return file ? `${verb} ${file}` : past ? 'Edited multiple sections' : 'Editing multiple sections'
    }

    case 'Read': {
      const file = extractFilename(toolInput.file_path)
      const verb = past ? 'Reviewed' : 'Reviewing'
      return file ? `${verb} ${file}` : `${verb} a file`
    }

    case 'NotebookEdit':
      return past ? 'Updated notebook' : 'Updating notebook'

    case 'Bash': {
      const cmd: string = toolInput.command ?? ''
      return describeBashCommand(cmd, past)
    }

    case 'Glob':
    case 'Grep':
      return past ? 'Searched the codebase' : 'Searching the codebase'

    // Agent / task tools
    case 'Task': {
      const desc = toolInput.description || ''
      const subagent = friendlyAgentType(toolInput.subagent_type)
      if (subagent) {
        return past ? `Ran ${subagent}` : `Running ${subagent}`
      }
      if (desc) {
        return past ? `Delegated: ${desc}` : `Delegating: ${desc}`
      }
      return past ? 'Delegated work to a helper agent' : 'Delegating work to a helper agent'
    }

    case 'TaskOutput':
      return past ? 'Checked on a background task' : 'Checking on a background task'

    case 'TaskCreate':
      return past ? 'Created a new task' : 'Creating a new task'

    case 'TaskUpdate':
      return past ? 'Updated task progress' : 'Updating task progress'

    case 'TaskList':
      return past ? 'Reviewed task list' : 'Reviewing task list'

    case 'TaskGet':
      return past ? 'Checked task details' : 'Checking task details'

    case 'SendMessage':
      return past ? 'Sent a message to teammate' : 'Messaging a teammate'

    case 'TeamCreate':
      return past ? 'Created a team of agents' : 'Creating a team of agents'

    // Planning tools
    case 'EnterPlanMode':
      return past ? 'Started planning' : 'Starting to plan'

    case 'ExitPlanMode':
      return past ? 'Finished planning' : 'Finishing plan'

    case 'AskUserQuestion':
      return past ? 'Asked you a question' : 'Asking you a question'

    // Web tools
    case 'WebFetch':
      return past ? 'Fetched a web page' : 'Fetching a web page'

    case 'WebSearch':
      return past ? 'Searched the web' : 'Searching the web'

    // MCP / external tools
    case 'Skill':
      return past ? 'Ran a skill' : 'Running a skill'

    default: {
      if (!toolName) return past ? 'Working' : 'Working'
      // Make unknown tool names friendlier by adding spaces before capitals
      const friendly = toolName.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
      return past ? `Finished ${friendly}` : `Running ${friendly}`
    }
  }
}

/**
 * Map common bash commands to friendly descriptions.
 */
function describeBashCommand(cmd: string, past: boolean): string {
  if (!cmd) return past ? 'Ran a command' : 'Running a command'

  const trimmed = cmd.trim()

  // Skip heredocs, shell fragments, and multiline noise
  if (/\$\(|<<|EOF|heredoc/i.test(trimmed)) {
    return past ? 'Ran a command' : 'Running a command'
  }

  // Test commands
  if (
    /\b(bun\s+test|npm\s+test|npx\s+jest|jest|vitest|pytest|cargo\s+test|go\s+test)\b/.test(
      trimmed,
    )
  ) {
    return past ? 'Ran tests' : 'Running tests'
  }

  // Install commands
  if (
    /\b(bun\s+install|bun\s+add|npm\s+install|npm\s+ci|yarn\s+install|yarn\s+add|pip\s+install|pnpm\s+install|pnpm\s+add)\b/.test(
      trimmed,
    )
  ) {
    return past ? 'Installed dependencies' : 'Installing dependencies'
  }

  // Git commands
  if (/\bgit\s+commit\b/.test(trimmed)) {
    return past ? 'Committed changes' : 'Committing changes'
  }
  if (/\bgit\s+push\b/.test(trimmed)) {
    return past ? 'Pushed to remote' : 'Pushing to remote'
  }
  if (/\bgit\s+pull\b/.test(trimmed)) {
    return past ? 'Pulled latest' : 'Pulling latest'
  }
  if (/\bgit\s+(checkout|switch)\b/.test(trimmed)) {
    return past ? 'Switched branch' : 'Switching branch'
  }
  if (/\bgit\s+merge\b/.test(trimmed)) {
    return past ? 'Merged branch' : 'Merging branch'
  }
  if (/\bgit\s+rebase\b/.test(trimmed)) {
    return past ? 'Rebased branch' : 'Rebasing branch'
  }
  if (/\bgit\s+stash\b/.test(trimmed)) {
    return past ? 'Stashed changes' : 'Stashing changes'
  }

  // Build / dev commands
  if (/\b(bun\s+run\s+build|npm\s+run\s+build|vite\s+build)\b/.test(trimmed)) {
    return past ? 'Built project' : 'Building project'
  }
  if (/\b(bun\s+dev|npm\s+run\s+dev|vite)\b/.test(trimmed)) {
    return past ? 'Started dev server' : 'Starting dev server'
  }

  // Lint / format
  if (/\b(eslint|prettier|biome|tsc\b)/.test(trimmed)) {
    return past ? 'Ran linter' : 'Running linter'
  }

  // Generic fallback: show the first meaningful token(s)
  const short = trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed
  return past ? `Ran: ${short}` : `Running: ${short}`
}

// ---------------------------------------------------------------------------
// humanizeTestStatus
// ---------------------------------------------------------------------------

/**
 * "passing", "45 passed" -> "Tests passing"
 * "failing", "3 failed"  -> "Tests failing"
 * "unknown"              -> "Tests unknown"
 */
export function humanizeTestStatus(
  status: string,
  summary?: string,
): string {
  if (!status) return 'Tests unknown'

  const s = status.toLowerCase()

  if (s === 'passing' || s === 'passed') {
    return summary ? `Tests passing (${summary})` : 'Tests passing'
  }
  if (s === 'failing' || s === 'failed') {
    return summary ? `Tests failing (${summary})` : 'Tests failing'
  }

  return 'Tests unknown'
}

// ---------------------------------------------------------------------------
// humanizeDevServer
// ---------------------------------------------------------------------------

/**
 * Parses a JSON string of dev servers and returns a friendly description.
 *
 * {port: 5173, type: "vite"} -> "Running on localhost:5173"
 */
export function humanizeDevServer(devServersJson: string): string | null {
  if (!devServersJson) return null

  try {
    const servers = JSON.parse(devServersJson)

    if (!Array.isArray(servers) || servers.length === 0) return null

    const descriptions = servers.map((s: { port?: number; type?: string }) => {
      const port = s.port ?? '???'
      return `Running on localhost:${port}`
    })

    return descriptions.join(', ')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// humanizeDuration
// ---------------------------------------------------------------------------

/**
 * 23 -> "23 minutes"
 * 1  -> "1 minute"
 * 0  -> "Less than a minute"
 * 90 -> "1.5 hours"
 */
export function humanizeDuration(minutes: number): string {
  if (minutes == null || minutes < 0) return 'Unknown duration'
  if (minutes === 0) return 'Less than a minute'
  if (minutes === 1) return '1 minute'
  if (minutes < 60) return `${minutes} minutes`

  const hours = minutes / 60
  if (hours === 1) return '1 hour'

  // Show one decimal place only when it is not ".0"
  const rounded = Math.round(hours * 10) / 10
  if (rounded === Math.floor(rounded)) {
    return `${Math.floor(rounded)} hours`
  }
  return `${rounded} hours`
}

// ---------------------------------------------------------------------------
// humanizeTimeAgo
// ---------------------------------------------------------------------------

/**
 * Returns a relative time string such as "2 minutes ago" or "Yesterday".
 * Accepts a Unix timestamp in milliseconds.
 */
export function humanizeTimeAgo(timestamp: number): string {
  if (!timestamp) return ''

  const now = Date.now()
  const diffMs = now - timestamp
  if (diffMs < 0) return 'Just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds} seconds ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return `${minutes} minutes ago`

  const hours = Math.floor(minutes / 60)
  if (hours === 1) return '1 hour ago'
  if (hours < 24) return `${hours} hours ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`

  const weeks = Math.floor(days / 7)
  if (weeks === 1) return '1 week ago'
  if (weeks < 5) return `${weeks} weeks ago`

  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  if (months < 12) return `${months} months ago`

  const years = Math.floor(days / 365)
  if (years === 1) return '1 year ago'
  return `${years} years ago`
}

// ---------------------------------------------------------------------------
// getProjectColor
// ---------------------------------------------------------------------------

/**
 * Returns a stable HSL color string for a project name.
 * The same project name always resolves to the same color.
 * When `allProjectNames` is provided the function distributes colors evenly
 * across the palette by sorting the list and assigning by index, falling back
 * to a hash when the project is not found.
 */
export function getProjectColor(
  projectName: string,
  allProjectNames?: string[],
): string {
  if (!projectName) return PROJECT_COLORS[0]

  if (allProjectNames && allProjectNames.length > 0) {
    const sorted = [...allProjectNames].sort()
    const idx = sorted.indexOf(projectName)
    if (idx !== -1) {
      return PROJECT_COLORS[idx % PROJECT_COLORS.length]
    }
  }

  // Fallback: hash-based assignment
  return PROJECT_COLORS[simpleHash(projectName) % PROJECT_COLORS.length]
}

// ---------------------------------------------------------------------------
// isNoisyEvent
// ---------------------------------------------------------------------------

/**
 * Returns true when the event is "noisy" and should be hidden from simplified views.
 *
 * Filters out:
 * - All PreToolUse events (PostToolUse already describes the same action)
 * - Read, Glob, Grep (codebase scanning — too frequent to be interesting)
 * - TaskList, TaskGet (internal bookkeeping)
 */
export function isNoisyEvent(event: {
  hook_event_type: string
  payload: Record<string, any>
}): boolean {
  if (!event) return false

  const type = event.hook_event_type ?? ''
  const toolName = event.payload?.tool_name ?? ''

  // Filter out ALL PreToolUse — PostToolUse already covers the same action
  if (type === 'PreToolUse') return true

  // Only PostToolUse events can be noisy beyond that
  if (type !== 'PostToolUse') return false

  const noisyTools = ['Read', 'Glob', 'Grep', 'TaskList', 'TaskGet']
  return noisyTools.includes(toolName)
}

// ---------------------------------------------------------------------------
// basename
// ---------------------------------------------------------------------------

/**
 * Extracts just the filename from a file path.
 * "/Users/foo/bar/component.tsx" -> "component.tsx"
 */
export function basename(filePath: string): string {
  if (!filePath) return ''
  return extractFilename(filePath)
}
