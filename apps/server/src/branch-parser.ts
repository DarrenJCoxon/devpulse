/**
 * Branch Name Parser
 *
 * Parses Git branch names following common conventions into human-readable task context.
 * Supports common prefixes like feature/, fix/, chore/, hotfix/, release/, etc.
 * Extracts ticket IDs (e.g., AUTH-123, PROJ-456) and converts hyphenated text to Title Case.
 */

export interface TaskContext {
  prefix: string;       // "feature" | "fix" | "chore" | "hotfix" | "release" | ""
  ticket_id: string;    // "AUTH-123" or ""
  description: string;  // "Login Flow" (title-cased from hyphen-separated)
  display: string;      // "AUTH-123: Login Flow" or "Fix: Broken Navbar"
}

/**
 * Supported branch prefixes in order of priority.
 * These are the common Git flow convention prefixes.
 */
const SUPPORTED_PREFIXES = [
  'feature',
  'fix',
  'bugfix',
  'chore',
  'hotfix',
  'release',
  'refactor',
  'docs',
  'test'
] as const;

type SupportedPrefix = typeof SUPPORTED_PREFIXES[number];

/**
 * Parse a Git branch name into a structured task context.
 *
 * @param branch - Git branch name (e.g., "feature/AUTH-123-login-flow")
 * @returns TaskContext object with prefix, ticket_id, description, and display
 *
 * @example
 * parseBranchToTask("feature/AUTH-123-login-flow")
 * // => { prefix: "feature", ticket_id: "AUTH-123", description: "Login Flow", display: "AUTH-123: Login Flow" }
 *
 * @example
 * parseBranchToTask("fix/broken-navbar")
 * // => { prefix: "fix", ticket_id: "", description: "Broken Navbar", display: "Fix: Broken Navbar" }
 *
 * @example
 * parseBranchToTask("main")
 * // => { prefix: "", ticket_id: "", description: "main", display: "main" }
 */
export function parseBranchToTask(branch: string): TaskContext {
  if (!branch || typeof branch !== 'string') {
    return createEmptyContext('');
  }

  const trimmed = branch.trim();
  if (!trimmed) {
    return createEmptyContext('');
  }

  // Split on first '/' to get prefix and remainder
  const firstSlashIndex = trimmed.indexOf('/');

  // No slash found - not a prefixed branch (e.g., "main", "develop")
  if (firstSlashIndex === -1) {
    return createEmptyContext(trimmed);
  }

  const potentialPrefix = trimmed.slice(0, firstSlashIndex).toLowerCase();
  const remainder = trimmed.slice(firstSlashIndex + 1);

  // Check if the prefix is supported
  const prefix = SUPPORTED_PREFIXES.includes(potentialPrefix as SupportedPrefix)
    ? potentialPrefix
    : '';

  // If prefix not recognized, treat whole branch name as description
  if (!prefix) {
    return createEmptyContext(trimmed);
  }

  // Handle nested slashes (e.g., "feature/team/AUTH-456-thing")
  // Take everything after the prefix as the working string
  let workingString = remainder;

  // If there are more slashes, take only the last segment
  const lastSlashIndex = workingString.lastIndexOf('/');
  if (lastSlashIndex !== -1) {
    workingString = workingString.slice(lastSlashIndex + 1);
  }

  // Extract ticket ID: match pattern [A-Z]+-\d+ (e.g., "AUTH-123", "PROJ-42", "PROJECT-TEAM-123")
  // Pattern rewritten to avoid nested quantifiers (prevents ReDoS): match uppercase and hyphens, then verify ends with hyphen+digits
  const ticketMatch = workingString.match(/\b([A-Z][A-Z-]*-\d+)\b/);
  const ticket_id = ticketMatch?.[1] ?? '';

  // Build description from remaining text
  let descriptionText = workingString;

  // Remove the ticket ID from the description text if found
  if (ticket_id) {
    descriptionText = descriptionText.replace(ticket_id, '').replace(/^-+|-+$/g, '');
  }

  // Convert hyphen-separated words to Title Case
  const description = toTitleCase(descriptionText);

  // Build display string
  let display = '';
  if (ticket_id && description) {
    display = `${ticket_id}: ${description}`;
  } else if (ticket_id) {
    display = ticket_id;
  } else if (description) {
    display = `${capitalize(prefix)}: ${description}`;
  } else {
    display = capitalize(prefix);
  }

  return {
    prefix,
    ticket_id,
    description,
    display
  };
}

/**
 * Create an empty/passthrough context for unparseable branches.
 */
function createEmptyContext(branch: string): TaskContext {
  return {
    prefix: '',
    ticket_id: '',
    description: branch,
    display: branch
  };
}

/**
 * Convert a hyphen-separated string to Title Case.
 *
 * @example
 * toTitleCase("login-flow") // => "Login Flow"
 * toTitleCase("broken-navbar-fix") // => "Broken Navbar Fix"
 */
function toTitleCase(text: string): string {
  if (!text) return '';

  return text
    .split(/[-_\s]+/)
    .filter(word => word.length > 0)
    .map(word => capitalize(word))
    .join(' ');
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(text: string): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}
