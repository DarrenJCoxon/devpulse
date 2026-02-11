// New interface for human-in-the-loop requests
export interface HumanInTheLoop {
  question: string;
  responseWebSocketUrl: string;
  type: 'question' | 'permission' | 'choice';
  choices?: string[]; // For multiple choice questions
  timeout?: number; // Optional timeout in seconds
  requiresResponse?: boolean; // Whether response is required or optional
}

// Response interface
export interface HumanInTheLoopResponse {
  response?: string;
  permission?: boolean;
  choice?: string; // Selected choice from options
  hookEvent: HookEvent;
  respondedAt: number;
  respondedBy?: string; // Optional user identifier
}

// Status tracking interface
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

  // NEW: Optional HITL data
  humanInTheLoop?: HumanInTheLoop;
  humanInTheLoopStatus?: HumanInTheLoopStatus;
}

export interface FilterOptions {
  source_apps: string[];
  session_ids: string[];
  hook_event_types: string[];
}

// --- DevPulse types ---

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
  task_context: string;  // JSON string of TaskContext (from server branch-parser)
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

export interface WebSocketMessage {
  type: 'initial' | 'event' | 'hitl_response' | 'projects' | 'sessions' | 'topology' | 'conflicts';
  data: HookEvent | HookEvent[] | HumanInTheLoopResponse | Project[] | Session[] | AgentNode[] | FileConflict[];
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

export type TimeRange = '1m' | '3m' | '5m' | '10m';

export interface ChartDataPoint {
  timestamp: number;
  count: number;
  eventTypes: Record<string, number>; // event type -> count
  toolEvents?: Record<string, number>; // "EventType:ToolName" -> count (e.g., "PreToolUse:Bash" -> 3)
  sessions: Record<string, number>; // session id -> count
}

export interface ChartConfig {
  maxDataPoints: number;
  animationDuration: number;
  barWidth: number;
  barGap: number;
  colors: {
    primary: string;
    glow: string;
    axis: string;
    text: string;
  };
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

// --- Notification types (E3-S4) ---

export interface NotificationSettings {
  enabled: boolean;
  types: string[];
}

// --- Cost types (E4-S2) ---

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

// --- Agent Performance Metrics types (E4-S4) ---

export interface SessionMetrics {
  session_id: string;
  source_app: string;
  project_name: string;
  model_name: string;
  // Tool metrics
  tool_use_count: number;
  tool_failure_count: number;
  tool_success_rate: number;       // 0-100 percentage
  tool_breakdown: Record<string, { success: number; failure: number }>;
  // Turn metrics
  turn_count: number;
  avg_turn_duration_seconds: number;
  median_turn_duration_seconds: number;
  min_turn_duration_seconds: number;
  max_turn_duration_seconds: number;
  // Activity metrics
  total_events: number;
  events_per_minute: number;
  session_duration_minutes: number;
  // Timeline (for sparkline)
  activity_timeline: Array<{ minute: number; events: number }>;
}

export interface ProjectMetrics {
  project_name: string;
  session_count: number;
  avg_tool_success_rate: number;
  avg_turn_duration_seconds: number;
  total_events: number;
  total_duration_minutes: number;
}

// --- Cross-Project File Conflict types (E4-S5) ---

export interface FileConflict {
  id: string;
  file_path: string;
  severity: 'high' | 'medium' | 'low';
  projects: Array<{
    project_name: string;
    agent_id: string;      // source_app:session_id (truncated to 8 chars)
    access_type: 'read' | 'write';
    last_access: number;
  }>;
  detected_at: number;
  dismissed: boolean;
}