// Shared API response types. Phase 1 hand-written; replaced by openapi-typescript output.

export interface HealthResponse {
  status: string;
  configured: boolean;
  jira: "configured" | "unconfigured";
  version: string;
}

export interface SyncRunSummary {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  scan_type: "incremental" | "full";
  trigger: "scheduled" | "manual";
  issues_seen: number;
  issues_inserted: number;
  issues_updated: number;
  issues_removed: number;
  sp_changes: number;
  assignee_changes: number;
  status_changes: number;
  error_message: string | null;
}

export interface ScheduledJob {
  id: string;
  cron: string | null;
  next_run_at: string | null;
}

export interface SettingsView {
  configured: boolean;
  jira_email: string;
  jira_base_url: string;
  jira_board_id: number;
  jira_team_field: string;
  jira_team_value_masked: string;
  jira_sprint_name_prefix: string;
  sync_cron: string;
  full_scan_cron: string;
  team_region: string;
  api_token_last4: string;
  anthropic_configured: boolean;
  anthropic_key_last4: string;
  anthropic_model: string;
}

export interface TestConnectionResponse {
  ok: boolean;
  account_id: string | null;
  display_name: string | null;
  message: string;
}

export interface SyncStatus {
  is_running: boolean;
  last_success_at: string | null;
  runs: SyncRunSummary[];
  scheduled: ScheduledJob[];
}

export interface Sprint {
  sprint_id: number;
  name: string;
  state: string;
  start_date: string | null;
  end_date: string | null;
  complete_date: string | null;
  board_id: number | null;
}

export interface Issue {
  issue_key: string;
  issue_type: string;
  summary: string;
  status: string;
  status_category: string;
  assignee_id: string | null;
  reporter_id: string | null;
  parent_key: string | null;
  epic_key: string | null;
  story_points: number | null;
  resolution_date: string | null;
  due_date: string | null;
  updated_at: string;
  last_seen_at: string;
  removed_at: string | null;
}

export interface IssuesPage {
  issues: Issue[];
  next_cursor: string | null;
}

export interface Epic {
  issue_key: string;
  summary: string;
  status: string;
  status_category: string;
  initiative_key: string | null;
  owner_account_id: string | null;
  due_date: string | null;
  issue_count: number;
  sp_total: number | null;
  sp_done: number | null;
}

export interface Initiative {
  issue_key: string;
  summary: string;
  status: string;
  status_category: string;
  owner_account_id: string | null;
  epic_count: number;
}

export interface Person {
  account_id: string;
  display_name: string;
  email: string | null;
  active: boolean;
  first_seen_at: string;
  last_seen_at: string;
}

export interface Leave {
  id: number;
  person_account_id: string;
  person_display_name: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  working_days: number | null;  // weekdays in [start, end] minus holidays
  created_at: string;
}

export interface Holiday {
  holiday_date: string;
  region: string;
  name: string;
  created_at: string;
}

export interface UpcomingPersonWindow {
  person_account_id: string;
  person_display_name: string | null;
  leaves: Leave[];
  total_days_in_window: number;
}

export interface UpcomingLeavesResponse {
  window_start: string;
  window_end: string;
  people: UpcomingPersonWindow[];
  overlap_alerts: {
    week_start: string;
    people_count: number;
    people: string[];
  }[];
}

export interface TeamMember {
  account_id: string;
  display_name: string | null;
  email: string | null;
  counts_for_capacity: boolean;
  added_at: string;
}

export interface SeedResult {
  added: string[];
  kept: number;
  total: number;
}

export interface LeaderRow {
  person_account_id: string;
  person_display_name: string | null;
  tickets_closed: number;
  sp_delivered: string | number;
  avg_sp_per_ticket: string | number | null;
}

export interface LeaderboardResponse {
  scope: "sprint" | "quarter" | "project";
  scope_label: string;
  window_start: string | null;
  window_end: string | null;
  total_tickets: number;
  total_sp: string | number;
  rows: LeaderRow[];
}

// ---- Insights (v3) ---------------------------------------------------------

export interface AnomalyCard {
  rule_id: string;
  title: string;
  description: string;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  firings: Record<string, unknown>[];
  firing_rate_recent: string | null;
}

export type LLMCardState =
  | "fresh"
  | "running"
  | "off"
  | "failed"
  | "key-missing"
  | "no-output";

export interface LLMCard {
  rule_id: string;
  title: string;
  description: string;
  enabled: boolean;
  state: LLMCardState;
  last_run_at: string | null;
  body_md: string | null;
  scope_label: string | null;
  error_message: string | null;
}

export interface InsightsFeed {
  anomalies: AnomalyCard[];
  summaries: LLMCard[];
  last_anomaly_eval_at: string | null;
  queued_runs: string[];
}

export interface InsightRuleRow {
  id: string;
  kind: "anomaly" | "llm";
  title: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_run_at: string | null;
  last_run_status: string | null;
  last_firings_count: number | null;
  last_tokens: number | null;
  prompt_version: number | null;
}

export interface InsightSpend {
  days: number;
  total_runs: number;
  tokens_in: number;
  tokens_out: number;
}

export interface InsightHistoryRow {
  id: number;
  rule_id: string;
  trigger: string;
  status: string;
  scope: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
  firings_count: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error_message: string | null;
}

export interface ScopeChange {
  id: number;
  issue_key: string;
  sprint_name: string;
  change_type: "sp" | "assignee" | "status" | "added_mid_sprint";
  old_value: string | null;
  new_value: string | null;
  sp_delta: number | null;
  detected_at: string;
}

// ---- Phase 3 metrics types -------------------------------------------------

export interface StatusBreakdown {
  todo_sp: string | number;
  in_progress_sp: string | number;
  review_sp: string | number;
  validation_sp: string | number;
  done_sp: string | number;
}

export interface PersonRollup {
  person_account_id: string;
  person_display_name: string | null;
  committed_sp: string | number;
  completed_sp: string | number;
  available_days: number;
  velocity: string | number | null;
  accuracy: string | number | null;
  status_breakdown: StatusBreakdown;
}

export interface HygieneInline {
  unassigned: number;
  missing_sp: number;
  missing_epic: number;
}

export interface SprintRollup {
  sprint_id: number;
  sprint_name: string;
  state: string;
  committed_sp: string | number;
  completed_sp: string | number;
  velocity_sp_per_person_day: string | number | null;
  projected_sp: string | number | null;
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  hygiene: HygieneInline;
  per_person: PersonRollup[];
}

export interface BurnupPoint {
  day: string;
  cumulative_done_sp: string | number;
  cumulative_committed_sp: string | number;
}

export interface BurnupResponse {
  sprint_id: number;
  sprint_name: string;
  target_sp: string | number;
  points: BurnupPoint[];
}

export interface CarryOverRow {
  issue_key: string;
  summary: string;
  assignee_id: string | null;
  assignee_display_name: string | null;
  depth: number;
  story_points: string | number | null;
}

export interface BlockerRow {
  issue_key: string;
  parent_key: string | null;
  summary: string;
  status: string;
  assignee_display_name: string | null;
  age_days: number;
  band: "green" | "yellow" | "red";
}

export interface VelocityRow {
  sprint_id: number;
  sprint_name: string;
  person_account_id: string;
  person_display_name: string | null;
  committed_sp: string | number;
  completed_sp: string | number;
  available_days: number;
  velocity: string | number | null;
  accuracy: string | number | null;
}

// ---- Phase 4 Epic Risk + Hygiene types -------------------------------------

export interface EpicRiskRow {
  issue_key: string;
  summary: string;
  status: string;
  status_category: string;
  initiative_key: string | null;
  owner_account_id: string | null;
  owner_display_name: string | null;
  due_date: string | null;
  days_overdue: number | null;
  issue_count: number;
  sp_total: string | number;
  sp_done: string | number;
  days_since_activity: number | null;
  risk_band: "at_risk" | "watch" | "on_track" | "future_scope" | "done";
  risk_reasons: string[];
  has_project: boolean;
}

export interface EpicRiskSummary {
  at_risk: number;
  watch: number;
  on_track: number;
  future_scope: number;
  done: number;
  no_project: number;
}

export interface EpicRiskResponse {
  summary: EpicRiskSummary;
  epics: EpicRiskRow[];
}

export interface ThroughputRow {
  sprint_id: number;
  sprint_name: string;
  closed_epics: number;
}

export interface EpicNoInitiativeRow {
  issue_key: string;
  summary: string;
  status: string;
  due_date: string | null;
  sp_open: string | number;
  days_since_activity: number | null;
}

export interface EpicsNoInitiativeResponse {
  epics: EpicNoInitiativeRow[];
  no_due_date_count: number;
}

export interface TaskNoEpicRow {
  issue_key: string;
  summary: string;
  issue_type: string;
  status: string;
  assignee_display_name: string | null;
  created_at: string | null;
  updated_at: string;
}

export interface TicketByDueRow {
  issue_key: string;
  summary: string;
  assignee_display_name: string | null;
  due_date: string;
  days_to_due: number;
  band: "red" | "yellow" | "green" | "grey";
  status: string;
  status_category: string;
}

export interface ProjectRaw {
  project_name: string;
  epic_count: number;
  epic_keys: string[];
  epic_status_categories: Record<string, number>;
  classification: "active" | "completed";
}

// ---- Phase 5: projects -----------------------------------------------------

export interface ProjectListRow {
  project_name: string;
  classification: "active" | "completed";
  epic_count: number;
  total_sp: string | number;
  done_sp: string | number;
  pct_done: string | number;
  sprints_active: number;
  avg_velocity_sp: string | number | null;
  avg_sprint_length_d: string | number | null;
  scope_churn_pct: string | number | null;
  etd_by_velocity: string | null;          // YYYY-MM-DD
  etd_by_sprint_assignment: string | null; // YYYY-MM-DD
  completed_at: string | null;             // ISO timestamp
}

export interface ProjectEpicRollup {
  issue_key: string;
  summary: string;
  status: string;
  status_category: string;
  issue_count: number;
  sp_total: string | number;
  sp_done: string | number;
}

export interface ProjectSprintTouched {
  sprint_id: number;
  name: string;
  state: string;
  start_date: string | null;
  end_date: string | null;
}

export interface ProjectDetail {
  project_name: string;
  classification: "active" | "completed";
  epic_count: number;
  total_sp: string | number;
  done_sp: string | number;
  pct_done: string | number;
  sprints_active: number;
  avg_velocity_sp: string | number | null;
  avg_sprint_length_d: string | number | null;
  etd_by_velocity: string | null;
  etd_by_velocity_basis: string;
  etd_by_sprint_assignment: string | null;
  etd_by_sprint_assignment_basis: string;
  sp_added_total: string | number;
  sp_removed_total: string | number;
  scope_churn_pct: string | number | null;
  contributors: string[];
  initiative_keys: string[];
  epics: ProjectEpicRollup[];
  sprints: ProjectSprintTouched[];
  completed_at: string | null;
}

export interface ComparisonStats {
  p25: string | number | null;
  median: string | number | null;
  p75: string | number | null;
  n: number;
}

export interface ProjectComparison {
  active: ProjectListRow[];
  completed_count: number;
  velocity: ComparisonStats;
  churn_pct: ComparisonStats;
  sprints_active: ComparisonStats;
  sprint_length_d: ComparisonStats;
  enough_history: boolean;
}

// ---- Ticket notes (standup board) ------------------------------------------

export interface TicketNote {
  id: number;
  issue_key: string;
  body: string;
  done: boolean;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface TicketNotesResponse {
  open: TicketNote[];
  done_recent: TicketNote[];
}

export interface TicketNoteWithContext extends TicketNote {
  summary: string;
  status: string;
  issue_type: string;
}
