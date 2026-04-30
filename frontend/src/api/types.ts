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

export interface SyncStatus {
  is_running: boolean;
  last_success_at: string | null;
  runs: SyncRunSummary[];
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
  created_at: string;
}

export interface Holiday {
  holiday_date: string;
  region: string;
  name: string;
  created_at: string;
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
  velocity_sp_per_day: string | number | null;
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

export interface ProjectRaw {
  project_name: string;
  epic_count: number;
  epic_keys: string[];
  epic_status_categories: Record<string, number>;
  classification: "active" | "completed";
}
