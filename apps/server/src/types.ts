// ============================================
// DevPulse Extended Types
// ============================================

// --- Existing types (preserved from base repo) ---

export interface HumanInTheLoop {
  question: string;
  responseWebSocketUrl: string;
  type: 'question' | 'permission' | 'choice';
  choices?: string[];
  timeout?: number;
  requiresResponse?: boolean;
}

export interface HumanInTheLoopResponse {
  response?: string;
  permission?: boolean;
  choice?: string;
  hookEvent: HookEvent;
  respondedAt: number;
  respondedBy?: string;
}

export interface HumanInTheLoopStatus {
  status: 'pending' | 'responded' | 'timeout' | 'error';
  respondedAt?: number;
  response?: HumanInTheLoopResponse;
}

export interface HookEvent {
  id?: number;
  source_app: string;
  session_id: string;
  hook_event_type: string;
  payload: Record<string, any>;
  chat?: any[];
  summary?: string;
  timestamp?: number;
  model_name?: string;
  humanInTheLoop?: HumanInTheLoop;
  humanInTheLoopStatus?: HumanInTheLoopStatus;
}

export interface FilterOptions {
  source_apps: string[];
  session_ids: string[];
  hook_event_types: string[];
}

// --- NEW: DevPulse types ---

export type SessionStatus = 'active' | 'idle' | 'waiting' | 'stopped';
export type TestStatus = 'passing' | 'failing' | 'unknown';

export interface Project {
  id?: number;
  name: string;
  path: string;
  current_branch: string;
  active_sessions: number;
  last_activity: number;
  test_status: TestStatus;
  test_summary: string;
  dev_servers: string;        // JSON array of {port, type}
  deployment_status: string;  // JSON string: {state, url, commit_message, created, vercel_project_id}
  created_at: number;
  updated_at: number;
}

export interface Session {
  id?: number;
  session_id: string;
  project_name: string;
  source_app: string;
  status: SessionStatus;
  current_branch: string;
  started_at: number;
  last_event_at: number;
  event_count: number;
  model_name: string;
  cwd: string;
  task_context: string;  // JSON string of TaskContext from branch-parser.ts
  compaction_count: number;  // E4-S3: Total compactions for this session
  last_compaction_at: number | null;  // E4-S3: Timestamp of last compaction
  compaction_history: string;  // E4-S3: JSON array of last 20 compaction timestamps
}

export interface DevLog {
  id?: number;
  session_id: string;
  project_name: string;
  branch: string;
  summary: string;
  files_changed: string;     // JSON array
  commits: string;           // JSON array
  started_at: number;
  ended_at: number;
  duration_minutes: number;
  event_count: number;
  tool_breakdown: string;    // JSON object {"Read": 5, "Write": 12, ...}
}

export interface ProjectStatus {
  project: Project;
  sessions: Session[];
  recent_logs: DevLog[];
}

export interface EnrichedEvent extends HookEvent {
  project_name?: string;
  branch?: string;
  uncommitted_files?: number;
}

// --- Summary types (E3-S3) ---

export interface PeriodSummary {
  period: 'daily' | 'weekly';
  start_date: string;      // ISO date: "2026-02-11"
  end_date: string;        // ISO date: "2026-02-11" (daily) or "2026-02-17" (weekly)
  projects: ProjectSummary[];
  totals: SummaryTotals;
}

export interface ProjectSummary {
  project_name: string;
  session_count: number;
  total_duration_minutes: number;
  files_changed: string[];   // Deduplicated across sessions
  commit_count: number;
  commits: string[];         // Commit messages
  tool_breakdown: Record<string, number>;  // Aggregated across sessions
  dev_logs: DevLog[];        // The raw dev log entries
}

export interface SummaryTotals {
  total_sessions: number;
  total_duration_minutes: number;
  total_files_changed: number;
  total_commits: number;
  active_projects: number;
}

// --- Agent Topology types (E4-S1) ---

export interface AgentNode {
  agent_id: string;           // source_app:session_id
  parent_id: string | null;   // null for root agents
  status: SessionStatus;
  model_name: string;
  project_name: string;
  task_context: string;       // JSON string or plain text
  started_at: number;
  last_event_at: number;
  children: string[];         // child agent_ids
}

// --- Cost Tracking types (E4-S2) ---

export interface ModelPricing {
  model_pattern: string;   // Regex pattern to match model_name
  input_per_1m: number;    // USD per 1M input tokens
  output_per_1m: number;   // USD per 1M output tokens
  display_name: string;
}

export const DEFAULT_PRICING: ModelPricing[] = [
  { model_pattern: 'opus', input_per_1m: 15, output_per_1m: 75, display_name: 'Opus 4.6' },
  { model_pattern: 'sonnet', input_per_1m: 3, output_per_1m: 15, display_name: 'Sonnet 4.5' },
  { model_pattern: 'haiku', input_per_1m: 0.80, output_per_1m: 4, display_name: 'Haiku 4.5' },
];

export interface CostEstimate {
  id?: number;
  session_id: string;
  source_app: string;
  project_name: string;
  model_name: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  event_count: number;
  calculated_at: number;
}

export interface ProjectCost {
  project_name: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  session_count: number;
  model_distribution: Record<string, number>; // model_name -> session count
}

export interface SessionCost {
  session_id: string;
  source_app: string;
  model_name: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  event_count: number;
  started_at: number;
  duration_minutes: number;
}

export interface DailyCost {
  date: string;              // YYYY-MM-DD
  total_cost_usd: number;
  projects: Record<string, number>; // project_name -> cost
}

// --- Theme types (preserved from base repo) ---

export interface ThemeColors {
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryDark: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgQuaternary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
  borderPrimary: string;
  borderSecondary: string;
  borderTertiary: string;
  accentSuccess: string;
  accentWarning: string;
  accentError: string;
  accentInfo: string;
  shadow: string;
  shadowLg: string;
  hoverBg: string;
  activeBg: string;
  focusRing: string;
}

export interface Theme {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  colors: ThemeColors;
  isPublic: boolean;
  authorId?: string;
  authorName?: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  downloadCount?: number;
  rating?: number;
  ratingCount?: number;
}

export interface ThemeSearchQuery {
  query?: string;
  tags?: string[];
  authorId?: string;
  isPublic?: boolean;
  sortBy?: 'name' | 'created' | 'updated' | 'downloads' | 'rating';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ThemeShare {
  id: string;
  themeId: string;
  shareToken: string;
  expiresAt?: number;
  isPublic: boolean;
  allowedUsers: string[];
  createdAt: number;
  accessCount: number;
}

export interface ThemeRating {
  id: string;
  themeId: string;
  userId: string;
  rating: number;
  comment?: string;
  createdAt: number;
}

export interface ThemeValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  validationErrors?: ThemeValidationError[];
}
