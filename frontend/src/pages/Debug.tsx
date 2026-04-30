import { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useEpics,
  useHolidays,
  useInitiatives,
  useIssues,
  usePeople,
  useProjectsRaw,
  useScopeChanges,
  useSprints,
  useSyncStatus,
} from "../api";
import DataTable, { type Column } from "../components/DataTable";
import { JiraLink } from "../lib/jira";
import LeavesTab from "./debug/LeavesTab";
import type {
  Epic,
  Holiday,
  Initiative,
  Issue,
  Person,
  ProjectRaw,
  ScopeChange,
  Sprint,
  SyncRunSummary,
} from "../api/types";

const TABS: { id: string; label: string }[] = [
  { id: "issues", label: "Issues" },
  { id: "sprints", label: "Sprints" },
  { id: "epics", label: "Epics" },
  { id: "initiatives", label: "Initiatives" },
  { id: "people", label: "People" },
  { id: "scope-changes", label: "Scope changes" },
  { id: "projects", label: "Projects" },
  { id: "leaves", label: "Leaves" },
  { id: "holidays", label: "Holidays" },
  { id: "sync-runs", label: "Sync runs" },
];

export default function Debug() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const active = params.get("tab") ?? "issues";

  return (
    <div>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>Debug — raw data</h1>
      <p style={{ color: "var(--color-text-muted)", marginTop: 0 }}>
        Phase 1 verification view. One tab per entity table; numbers should
        match Jira / <code>psql</code> counts.
      </p>

      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          borderBottom: "1px solid var(--color-border)",
          flexWrap: "wrap",
        }}
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => navigate(`/debug?tab=${t.id}`)}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              border: "none",
              borderBottom:
                active === t.id
                  ? "2px solid var(--color-accent)"
                  : "2px solid transparent",
              background: "transparent",
              color: active === t.id ? "var(--color-accent)" : "var(--color-text)",
              cursor: "pointer",
              fontWeight: active === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <TabBody tab={active} />
    </div>
  );
}

function TabBody({ tab }: { tab: string }): ReactNode {
  switch (tab) {
    case "issues":
      return <IssuesTab />;
    case "sprints":
      return <SprintsTab />;
    case "epics":
      return <EpicsTab />;
    case "initiatives":
      return <InitiativesTab />;
    case "people":
      return <PeopleTab />;
    case "scope-changes":
      return <ScopeChangesTab />;
    case "projects":
      return <ProjectsTab />;
    case "leaves":
      return <LeavesTab />;
    case "holidays":
      return <HolidaysTab />;
    case "sync-runs":
      return <SyncRunsTab />;
    default:
      return null;
  }
}

// ---------- Tabs ------------------------------------------------------------

function IssuesTab() {
  const { data, isLoading } = useIssues({ limit: 100 });
  if (isLoading) return <div>Loading…</div>;
  const rows = data?.issues ?? [];
  const columns: Column<Issue>[] = [
    {
      key: "key",
      label: "Key",
      sortValue: (r) => r.issue_key,
      render: (r) => <JiraLink issueKey={r.issue_key} />,
    },
    { key: "type", label: "Type", sortValue: (r) => r.issue_type, render: (r) => r.issue_type },
    {
      key: "summary",
      label: "Summary",
      sortValue: (r) => r.summary,
      render: (r) => r.summary,
    },
    { key: "status", label: "Status", sortValue: (r) => r.status, render: (r) => r.status },
    {
      key: "cat",
      label: "Cat",
      sortValue: (r) => r.status_category,
      render: (r) => <code>{r.status_category}</code>,
    },
    {
      key: "sp",
      label: "SP",
      sortValue: (r) => r.story_points,
      render: (r) => r.story_points ?? "",
    },
    {
      key: "assignee",
      label: "Assignee",
      sortValue: (r) => r.assignee_id,
      render: (r) => r.assignee_id ?? "",
    },
    {
      key: "epic",
      label: "Epic",
      sortValue: (r) => r.epic_key,
      render: (r) => (r.epic_key ? <JiraLink issueKey={r.epic_key} /> : ""),
    },
    {
      key: "removed",
      label: "Active",
      sortValue: (r) => (r.removed_at ? 0 : 1),
      render: (r) =>
        r.removed_at ? (
          <span style={{ color: "var(--color-bad)" }}>removed</span>
        ) : (
          <span style={{ color: "var(--color-good)" }}>active</span>
        ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.issue_key}
      initialSort={{ key: "key", dir: "asc" }}
      searchableField={(r) => `${r.issue_key} ${r.summary} ${r.assignee_id ?? ""}`}
      emptyMessage="No issues yet — run a full sync from the top bar."
    />
  );
}

function SprintsTab() {
  const { data = [], isLoading } = useSprints();
  if (isLoading) return <div>Loading…</div>;
  const columns: Column<Sprint>[] = [
    { key: "id", label: "ID", sortValue: (r) => r.sprint_id, render: (r) => r.sprint_id },
    { key: "name", label: "Name", sortValue: (r) => r.name, render: (r) => r.name },
    { key: "state", label: "State", sortValue: (r) => r.state, render: (r) => r.state },
    {
      key: "start",
      label: "Start",
      sortValue: (r) => r.start_date,
      render: (r) => r.start_date?.slice(0, 10) ?? "",
    },
    {
      key: "end",
      label: "End",
      sortValue: (r) => r.end_date,
      render: (r) => r.end_date?.slice(0, 10) ?? "",
    },
    {
      key: "complete",
      label: "Completed",
      sortValue: (r) => r.complete_date,
      render: (r) => r.complete_date?.slice(0, 10) ?? "",
    },
    { key: "board", label: "Board", sortValue: (r) => r.board_id, render: (r) => r.board_id ?? "" },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      rowKey={(r) => String(r.sprint_id)}
      initialSort={{ key: "start", dir: "desc" }}
      searchableField={(r) => r.name}
      emptyMessage="No sprints synced."
    />
  );
}

function EpicsTab() {
  const { data = [], isLoading } = useEpics();
  if (isLoading) return <div>Loading…</div>;
  const columns: Column<Epic>[] = [
    { key: "key", label: "Key", sortValue: (r) => r.issue_key, render: (r) => <JiraLink issueKey={r.issue_key} /> },
    { key: "summary", label: "Summary", sortValue: (r) => r.summary, render: (r) => r.summary },
    { key: "status", label: "Status", sortValue: (r) => r.status, render: (r) => r.status },
    {
      key: "init",
      label: "Initiative",
      sortValue: (r) => r.initiative_key,
      render: (r) => (r.initiative_key ? <JiraLink issueKey={r.initiative_key} /> : ""),
    },
    { key: "due", label: "Due", sortValue: (r) => r.due_date, render: (r) => r.due_date ?? "" },
    {
      key: "issues",
      label: "Issues",
      sortValue: (r) => r.issue_count,
      render: (r) => r.issue_count,
    },
    {
      key: "sp",
      label: "SP done / total",
      sortValue: (r) => r.sp_total,
      render: (r) => `${r.sp_done ?? 0} / ${r.sp_total ?? 0}`,
    },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      rowKey={(r) => r.issue_key}
      initialSort={{ key: "due", dir: "asc" }}
      searchableField={(r) => `${r.issue_key} ${r.summary}`}
      emptyMessage="No epics synced yet."
    />
  );
}

function InitiativesTab() {
  const { data = [], isLoading } = useInitiatives();
  if (isLoading) return <div>Loading…</div>;
  const columns: Column<Initiative>[] = [
    { key: "key", label: "Key", sortValue: (r) => r.issue_key, render: (r) => <JiraLink issueKey={r.issue_key} /> },
    { key: "summary", label: "Summary", sortValue: (r) => r.summary, render: (r) => r.summary },
    { key: "status", label: "Status", sortValue: (r) => r.status, render: (r) => r.status },
    {
      key: "epics",
      label: "Epics",
      sortValue: (r) => r.epic_count,
      render: (r) => r.epic_count,
    },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      rowKey={(r) => r.issue_key}
      initialSort={{ key: "key", dir: "asc" }}
      searchableField={(r) => `${r.issue_key} ${r.summary}`}
      emptyMessage="No initiatives synced yet."
    />
  );
}

function PeopleTab() {
  const { data = [], isLoading } = usePeople();
  if (isLoading) return <div>Loading…</div>;
  const columns: Column<Person>[] = [
    {
      key: "id",
      label: "Account ID",
      sortValue: (r) => r.account_id,
      render: (r) => <code>{r.account_id}</code>,
    },
    { key: "name", label: "Name", sortValue: (r) => r.display_name, render: (r) => r.display_name },
    { key: "email", label: "Email", sortValue: (r) => r.email, render: (r) => r.email ?? "" },
    {
      key: "active",
      label: "Active",
      sortValue: (r) => (r.active ? 1 : 0),
      render: (r) =>
        r.active ? (
          <span style={{ color: "var(--color-good)" }}>active</span>
        ) : (
          <span style={{ color: "var(--color-text-muted)" }}>inactive</span>
        ),
    },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      rowKey={(r) => r.account_id}
      initialSort={{ key: "name", dir: "asc" }}
      searchableField={(r) => `${r.display_name} ${r.email ?? ""} ${r.account_id}`}
    />
  );
}

function ScopeChangesTab() {
  const { data = [], isLoading } = useScopeChanges();
  if (isLoading) return <div>Loading…</div>;
  const columns: Column<ScopeChange>[] = [
    { key: "when", label: "Detected", sortValue: (r) => r.detected_at, render: (r) => r.detected_at },
    { key: "issue", label: "Issue", sortValue: (r) => r.issue_key, render: (r) => <JiraLink issueKey={r.issue_key} /> },
    { key: "sprint", label: "Sprint", sortValue: (r) => r.sprint_name, render: (r) => r.sprint_name },
    { key: "type", label: "Type", sortValue: (r) => r.change_type, render: (r) => <code>{r.change_type}</code> },
    { key: "old", label: "Old", render: (r) => r.old_value ?? "" },
    { key: "new", label: "New", render: (r) => r.new_value ?? "" },
    {
      key: "delta",
      label: "Δ SP",
      sortValue: (r) => r.sp_delta,
      render: (r) =>
        r.sp_delta == null
          ? ""
          : r.sp_delta > 0
            ? <span style={{ color: "var(--color-bad)" }}>+{r.sp_delta}</span>
            : <span style={{ color: "var(--color-good)" }}>{r.sp_delta}</span>,
    },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      rowKey={(r) => String(r.id)}
      initialSort={{ key: "when", dir: "desc" }}
      searchableField={(r) => `${r.issue_key} ${r.sprint_name} ${r.change_type}`}
      emptyMessage="No scope changes detected yet."
    />
  );
}

function ProjectsTab() {
  const { data = [], isLoading } = useProjectsRaw();
  if (isLoading) return <div>Loading…</div>;
  const columns: Column<ProjectRaw>[] = [
    {
      key: "name",
      label: "Project",
      sortValue: (r) => r.project_name,
      render: (r) => <strong>{r.project_name}</strong>,
    },
    {
      key: "class",
      label: "Status",
      sortValue: (r) => r.classification,
      render: (r) =>
        r.classification === "completed" ? (
          <span style={{ color: "var(--color-good)" }}>completed</span>
        ) : (
          <span style={{ color: "var(--color-accent)" }}>active</span>
        ),
    },
    { key: "epics", label: "Epics", sortValue: (r) => r.epic_count, render: (r) => r.epic_count },
    {
      key: "cats",
      label: "By status_category",
      render: (r) =>
        Object.entries(r.epic_status_categories)
          .map(([k, v]) => `${k}: ${v}`)
          .join("  "),
    },
    {
      key: "keys",
      label: "Epic keys",
      render: (r) => (
        <code style={{ fontSize: 11 }}>{r.epic_keys.join(", ")}</code>
      ),
    },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      rowKey={(r) => r.project_name}
      initialSort={{ key: "class", dir: "asc" }}
      searchableField={(r) => r.project_name}
      emptyMessage="No proj_* labels found on epics yet."
    />
  );
}

function HolidaysTab() {
  const { data = [], isLoading } = useHolidays();
  if (isLoading) return <div>Loading…</div>;
  const columns: Column<Holiday>[] = [
    {
      key: "date",
      label: "Date",
      sortValue: (r) => r.holiday_date,
      render: (r) => r.holiday_date,
    },
    { key: "name", label: "Name", render: (r) => r.name },
    { key: "region", label: "Region", render: (r) => <code>{r.region}</code> },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      rowKey={(r) => `${r.region}-${r.holiday_date}`}
      initialSort={{ key: "date", dir: "asc" }}
      emptyMessage="No holidays seeded. Run `make seed-holidays`."
    />
  );
}

function SyncRunsTab() {
  const { data, isLoading } = useSyncStatus();
  if (isLoading) return <div>Loading…</div>;
  const rows = data?.runs ?? [];
  const columns: Column<SyncRunSummary>[] = [
    { key: "id", label: "ID", sortValue: (r) => r.id, render: (r) => r.id },
    {
      key: "status",
      label: "Status",
      sortValue: (r) => r.status,
      render: (r) => (
        <span
          style={{
            color:
              r.status === "success"
                ? "var(--color-good)"
                : r.status === "failed"
                  ? "var(--color-bad)"
                  : "var(--color-warn)",
          }}
        >
          {r.status}
        </span>
      ),
    },
    { key: "scan", label: "Scan", render: (r) => r.scan_type },
    { key: "trigger", label: "Trigger", render: (r) => r.trigger },
    { key: "started", label: "Started", sortValue: (r) => r.started_at, render: (r) => r.started_at },
    {
      key: "duration",
      label: "Duration",
      render: (r) => {
        if (!r.finished_at) return "—";
        const ms =
          new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
        return `${(ms / 1000).toFixed(1)}s`;
      },
    },
    {
      key: "issues",
      label: "Issues seen",
      sortValue: (r) => r.issues_seen,
      render: (r) => r.issues_seen,
    },
    {
      key: "events",
      label: "SP / asn / sts events",
      render: (r) =>
        `${r.sp_changes} / ${r.assignee_changes} / ${r.status_changes}`,
    },
    {
      key: "err",
      label: "Error",
      render: (r) =>
        r.error_message ? (
          <span style={{ color: "var(--color-bad)" }}>{r.error_message}</span>
        ) : (
          ""
        ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => String(r.id)}
      initialSort={{ key: "started", dir: "desc" }}
      emptyMessage="No sync runs yet. Click Refresh."
    />
  );
}
