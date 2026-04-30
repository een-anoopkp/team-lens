// Typed fetchers + TanStack Query hooks for every Phase-1 endpoint.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BlockerRow,
  BurnupResponse,
  CarryOverRow,
  Epic,
  HealthResponse,
  Holiday,
  Initiative,
  IssuesPage,
  Leave,
  Person,
  ProjectRaw,
  ScopeChange,
  Sprint,
  SprintRollup,
  SyncStatus,
  VelocityRow,
} from "./types";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    let detail: unknown = undefined;
    try {
      detail = await res.json();
    } catch {
      // ignore
    }
    throw Object.assign(new Error(`${path} → ${res.status}`), {
      status: res.status,
      detail,
    });
  }
  return (await res.json()) as T;
}

async function postJSON<T, B = unknown>(path: string, body?: B): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail: unknown = undefined;
    try {
      detail = await res.json();
    } catch { /* ignore */ }
    throw Object.assign(new Error(`${path} → ${res.status}`), {
      status: res.status,
      detail,
    });
  }
  return (await res.json()) as T;
}

async function patchJSON<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function deleteVoid(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
}

// ---- Health -----------------------------------------------------------------

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => getJSON<HealthResponse>("/api/v1/health"),
    refetchInterval: 30_000,
  });
}

// ---- Sync -------------------------------------------------------------------

export function useSyncStatus() {
  return useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => getJSON<SyncStatus>("/api/v1/sync/status?limit=10"),
    refetchInterval: (query) => (query.state.data?.is_running ? 2_000 : 30_000),
  });
}

export function useRunSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scan_type: "incremental" | "full") =>
      postJSON<{ sync_run_id: number }>("/api/v1/sync/run", { scan_type }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync", "status"] });
    },
  });
}

// ---- Sprints ----------------------------------------------------------------

export function useSprints(state: "active" | "closed" | "future" | "all" = "all") {
  return useQuery({
    queryKey: ["sprints", state],
    queryFn: () => getJSON<Sprint[]>(`/api/v1/sprints?state=${state}&limit=200`),
  });
}

export function useActiveSprint() {
  return useQuery({
    queryKey: ["sprints", "active"],
    queryFn: async () => {
      try {
        return await getJSON<Sprint>("/api/v1/sprints/active");
      } catch (e: unknown) {
        const status = (e as { status?: number }).status;
        if (status === 404) return null;
        throw e;
      }
    },
  });
}

export function useSprintRollup(sprintId: number | undefined) {
  return useQuery({
    queryKey: ["sprints", sprintId, "rollup"],
    queryFn: () => getJSON<SprintRollup>(`/api/v1/sprints/${sprintId}/rollup`),
    enabled: sprintId != null,
  });
}

// ---- Phase 3 metrics --------------------------------------------------------

export function useBurnup(sprintId: number | undefined) {
  return useQuery({
    queryKey: ["metrics", "burnup", sprintId],
    queryFn: () =>
      getJSON<BurnupResponse>(`/api/v1/metrics/burnup?sprint_id=${sprintId}`),
    enabled: sprintId != null,
  });
}

export function useCarryOver(sprintId: number | undefined) {
  return useQuery({
    queryKey: ["metrics", "carry-over", sprintId],
    queryFn: () =>
      getJSON<CarryOverRow[]>(`/api/v1/metrics/carry-over?sprint_id=${sprintId}`),
    enabled: sprintId != null,
  });
}

export function useBlockers(sprintId: number | undefined) {
  return useQuery({
    queryKey: ["metrics", "blockers", sprintId],
    queryFn: () =>
      getJSON<BlockerRow[]>(`/api/v1/metrics/blockers?sprint_id=${sprintId}`),
    enabled: sprintId != null,
  });
}

export function useVelocity(sprintWindow = 6, person?: string) {
  const qs = new URLSearchParams({ sprint_window: String(sprintWindow) });
  if (person) qs.set("person", person);
  return useQuery({
    queryKey: ["metrics", "velocity", sprintWindow, person],
    queryFn: () => getJSON<VelocityRow[]>(`/api/v1/metrics/velocity?${qs}`),
  });
}

// ---- Phase 4 metrics --------------------------------------------------------

export function useEpicRisk() {
  return useQuery({
    queryKey: ["metrics", "epic-risk"],
    queryFn: () =>
      getJSON<import("./types").EpicRiskResponse>("/api/v1/metrics/epic-risk"),
  });
}

export function useEpicThroughput(window = 6) {
  return useQuery({
    queryKey: ["metrics", "epic-throughput", window],
    queryFn: () =>
      getJSON<import("./types").ThroughputRow[]>(
        `/api/v1/metrics/epic-throughput?sprint_window=${window}`
      ),
  });
}

export function useEpicsNoInitiative() {
  return useQuery({
    queryKey: ["hygiene", "epics-no-initiative"],
    queryFn: () =>
      getJSON<import("./types").EpicsNoInitiativeResponse>(
        "/api/v1/hygiene/epics-no-initiative"
      ),
  });
}

export function useTasksNoEpic() {
  return useQuery({
    queryKey: ["hygiene", "tasks-no-epic"],
    queryFn: () =>
      getJSON<import("./types").TaskNoEpicRow[]>(
        "/api/v1/hygiene/tasks-no-epic"
      ),
  });
}

export function useTicketsByDueDate(includeClosed = false) {
  return useQuery({
    queryKey: ["hygiene", "by-due-date", includeClosed],
    queryFn: () =>
      getJSON<import("./types").TicketByDueRow[]>(
        `/api/v1/hygiene/by-due-date?include_closed=${includeClosed}`
      ),
  });
}

// ---- Issues -----------------------------------------------------------------

export interface IssuesQuery {
  sprint_id?: number;
  assignee?: string;
  status_category?: "new" | "indeterminate" | "done";
  issue_type?: string;
  epic_key?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export function useIssues(params: IssuesQuery) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  return useQuery({
    queryKey: ["issues", params],
    queryFn: () => getJSON<IssuesPage>(`/api/v1/issues?${qs.toString()}`),
  });
}

// ---- Epics + initiatives ----------------------------------------------------

export function useEpics() {
  return useQuery({
    queryKey: ["epics"],
    queryFn: () => getJSON<Epic[]>("/api/v1/epics?limit=500"),
  });
}

export function useInitiatives() {
  return useQuery({
    queryKey: ["initiatives"],
    queryFn: () => getJSON<Initiative[]>("/api/v1/initiatives"),
  });
}

// ---- People -----------------------------------------------------------------

export function usePeople(opts: { teamOnly?: boolean } = {}) {
  const qs = new URLSearchParams({ active: "true" });
  if (opts.teamOnly) qs.set("team_only", "true");
  return useQuery({
    queryKey: ["people", opts.teamOnly ? "team" : "all"],
    queryFn: () => getJSON<Person[]>(`/api/v1/people?${qs.toString()}`),
  });
}

// ---- Team members (whitelist) -----------------------------------------------

export function useTeamMembers() {
  return useQuery({
    queryKey: ["team-members"],
    queryFn: () =>
      getJSON<import("./types").TeamMember[]>("/api/v1/team-members"),
  });
}

export function useAddTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (account_id: string) =>
      postJSON<import("./types").TeamMember>(
        `/api/v1/team-members/${encodeURIComponent(account_id)}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["people", "team"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (account_id: string) =>
      deleteVoid(`/api/v1/team-members/${encodeURIComponent(account_id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["people", "team"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

export function useSeedTeamMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number = 60) =>
      postJSON<import("./types").SeedResult>(
        `/api/v1/team-members/seed-recent?days=${days}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["people", "team"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

// ---- Scope changes ----------------------------------------------------------

export function useScopeChanges() {
  return useQuery({
    queryKey: ["scope-changes"],
    queryFn: () => getJSON<ScopeChange[]>("/api/v1/scope-changes?limit=200"),
  });
}

// ---- Projects (raw) ---------------------------------------------------------

export function useProjectsRaw() {
  return useQuery({
    queryKey: ["projects", "raw"],
    queryFn: () => getJSON<ProjectRaw[]>("/api/v1/projects/raw"),
  });
}

// ---- Leaves -----------------------------------------------------------------

export function useLeaves() {
  return useQuery({
    queryKey: ["leaves"],
    queryFn: () => getJSON<Leave[]>("/api/v1/leaves"),
  });
}

export function useUpcomingLeaves(weeks = 6) {
  return useQuery({
    queryKey: ["leaves", "upcoming", weeks],
    queryFn: () =>
      getJSON<import("./types").UpcomingLeavesResponse>(
        `/api/v1/leaves/upcoming?weeks=${weeks}`
      ),
  });
}

export function useCreateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      person_account_id: string;
      start_date: string;
      end_date: string;
      reason?: string;
    }) => postJSON<Leave>("/api/v1/leaves", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leaves"] }),
  });
}

export function useUpdateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      start_date?: string;
      end_date?: string;
      reason?: string | null;
    }) => patchJSON<Leave>(`/api/v1/leaves/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leaves"] }),
  });
}

export function useDeleteLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteVoid(`/api/v1/leaves/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leaves"] }),
  });
}

// ---- Holidays ---------------------------------------------------------------

export function useHolidays(region = "IN") {
  return useQuery({
    queryKey: ["holidays", region],
    queryFn: () => getJSON<Holiday[]>(`/api/v1/holidays?region=${region}`),
  });
}

export function useUpsertHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      holiday_date: string;
      region: string;
      name: string;
    }) => postJSON<Holiday>("/api/v1/holidays", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ region, date }: { region: string; date: string }) =>
      deleteVoid(
        `/api/v1/holidays/${encodeURIComponent(region)}/${encodeURIComponent(date)}`
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

// ---- Insights (v3) ----------------------------------------------------------

export function useInsightsFeed() {
  return useQuery({
    queryKey: ["insights", "feed"],
    queryFn: () =>
      getJSON<import("./types").InsightsFeed>("/api/v1/insights/feed"),
    refetchInterval: (query) => {
      const data = query.state.data as import("./types").InsightsFeed | undefined;
      const anyRunning = data?.summaries.some((s) => s.state === "running");
      return anyRunning ? 5_000 : 30_000;
    },
  });
}

export function useInsightRules() {
  return useQuery({
    queryKey: ["insights", "rules"],
    queryFn: () =>
      getJSON<{ rules: import("./types").InsightRuleRow[] }>(
        "/api/v1/insights/rules"
      ),
  });
}

export function useToggleInsightRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      fetch(`/api/v1/insights/rules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then((r) => {
        if (!r.ok) throw new Error(`toggle ${id} → ${r.status}`);
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useRunInsightRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      postJSON<{ queued: string }>(
        `/api/v1/insights/rules/${encodeURIComponent(id)}/run`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useRunInsightRuleFor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: Record<string, unknown> }) =>
      postJSON<{ queued: string }>(
        `/api/v1/insights/rules/${encodeURIComponent(id)}/run-for`,
        { scope }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useRunAllEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postJSON<{ queued: string[] }>("/api/v1/insights/run-all-enabled"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export function useInsightSpend(days = 30) {
  return useQuery({
    queryKey: ["insights", "spend", days],
    queryFn: () =>
      getJSON<import("./types").InsightSpend>(
        `/api/v1/insights/spend?days=${days}`
      ),
  });
}

export function useInsightHistory(limit = 20) {
  return useQuery({
    queryKey: ["insights", "history", limit],
    queryFn: () =>
      getJSON<import("./types").InsightHistoryRow[]>(
        `/api/v1/insights/history?limit=${limit}`
      ),
  });
}

// ---- Leaderboard ------------------------------------------------------------

export function useLeaderboardQuarters() {
  return useQuery({
    queryKey: ["leaderboard", "quarters"],
    queryFn: () =>
      getJSON<{ quarters: string[] }>("/api/v1/leaderboard/quarters"),
  });
}

export type LeaderboardScope =
  | { scope: "sprint"; sprint_id: number }
  | { scope: "quarter"; quarter: string }
  | { scope: "project"; project: string };

export function useLeaderboard(s: LeaderboardScope | null) {
  const qs = new URLSearchParams();
  if (s) {
    qs.set("scope", s.scope);
    if (s.scope === "sprint") qs.set("sprint_id", String(s.sprint_id));
    if (s.scope === "quarter") qs.set("quarter", s.quarter);
    if (s.scope === "project") qs.set("project", s.project);
  }
  return useQuery({
    queryKey: ["leaderboard", s],
    queryFn: () =>
      getJSON<import("./types").LeaderboardResponse>(
        `/api/v1/leaderboard?${qs.toString()}`
      ),
    enabled: s !== null,
  });
}

// ---- Settings ---------------------------------------------------------------

export function useSettings() {
  return useQuery({
    queryKey: ["setup", "settings"],
    queryFn: () =>
      getJSON<import("./types").SettingsView>("/api/v1/setup/settings"),
  });
}

export function useTestCurrentCreds() {
  return useMutation({
    mutationFn: () =>
      postJSON<import("./types").TestConnectionResponse>(
        "/api/v1/setup/test-current"
      ),
  });
}

// ---- Phase 5: projects ------------------------------------------------------

export function useProjects() {
  return useQuery({
    queryKey: ["projects", "list"],
    queryFn: () =>
      getJSON<import("./types").ProjectListRow[]>("/api/v1/projects"),
  });
}

export function useProject(name: string) {
  return useQuery({
    queryKey: ["projects", "detail", name],
    queryFn: () =>
      getJSON<import("./types").ProjectDetail>(
        `/api/v1/projects/${encodeURIComponent(name)}`
      ),
    enabled: !!name,
  });
}

export function useProjectComparison() {
  return useQuery({
    queryKey: ["projects", "comparison"],
    queryFn: () =>
      getJSON<import("./types").ProjectComparison>(
        "/api/v1/projects/comparison"
      ),
  });
}

// ---- Ticket notes (standup board) ------------------------------------------

export function useTicketNotes(issueKey: string | undefined) {
  return useQuery({
    queryKey: ["notes", issueKey],
    queryFn: () =>
      getJSON<import("./types").TicketNotesResponse>(
        `/api/v1/issues/${encodeURIComponent(issueKey!)}/notes`
      ),
    enabled: !!issueKey,
  });
}

export function useNotesCounts(sprintId: number | undefined) {
  return useQuery({
    queryKey: ["notes", "counts", sprintId],
    queryFn: () =>
      getJSON<Record<string, number>>(
        `/api/v1/notes/counts?sprint_id=${sprintId}`
      ),
    enabled: sprintId != null,
  });
}

function invalidateNotes(
  qc: ReturnType<typeof useQueryClient>,
  issueKey: string,
) {
  qc.invalidateQueries({ queryKey: ["notes", issueKey] });
  qc.invalidateQueries({ queryKey: ["notes", "counts"] });
  qc.invalidateQueries({ queryKey: ["notes", "all"] });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueKey, body }: { issueKey: string; body: string }) =>
      postJSON<import("./types").TicketNote>(
        `/api/v1/issues/${encodeURIComponent(issueKey)}/notes`,
        { body },
      ),
    onSuccess: (_, vars) => invalidateNotes(qc, vars.issueKey),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      issueKey: _issueKey,
      ...patch
    }: {
      id: number;
      issueKey: string;
      body?: string;
      done?: boolean;
    }) => patchJSON<import("./types").TicketNote>(`/api/v1/notes/${id}`, patch),
    onSuccess: (_, vars) => invalidateNotes(qc, vars.issueKey),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; issueKey: string }) =>
      deleteVoid(`/api/v1/notes/${id}`),
    onSuccess: (_, vars) => invalidateNotes(qc, vars.issueKey),
  });
}

/** Every note across every ticket — backs the global Notes page. */
export function useAllNotes(includeDone = false) {
  return useQuery({
    queryKey: ["notes", "all", includeDone],
    queryFn: () =>
      getJSON<import("./types").TicketNoteWithContext[]>(
        `/api/v1/notes?include_done=${includeDone}`
      ),
  });
}
