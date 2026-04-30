// Typed fetchers + TanStack Query hooks for every Phase-1 endpoint.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Epic,
  HealthResponse,
  Holiday,
  Initiative,
  Issue,
  IssuesPage,
  Leave,
  Person,
  ProjectRaw,
  ScopeChange,
  Sprint,
  SyncStatus,
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

export function usePeople() {
  return useQuery({
    queryKey: ["people"],
    queryFn: () => getJSON<Person[]>("/api/v1/people?active=true"),
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
