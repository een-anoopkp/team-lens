/**
 * Hygiene page — Phase 4.4.
 *
 * Three sortable panels:
 * - Epics without initiative (sorted by due_date asc)
 * - Tasks without epic (sorted by updated_at desc)
 * - Tickets by due date (asc; past-due red, ≤7d yellow, 8-30d green, >30d grey)
 *
 * The last panel has an "include closed-late" toggle for retro analysis.
 */

import { useState } from "react";

import {
  useEpicsNoInitiative,
  useTasksNoEpic,
  useTicketsByDueDate,
} from "../../api";
import type {
  EpicNoInitiativeRow,
  TaskNoEpicRow,
  TicketByDueRow,
} from "../../api/types";
import { JiraLink } from "../../lib/jira";

export default function HygienePage() {
  const epics = useEpicsNoInitiative();
  const tasks = useTasksNoEpic();
  const [includeClosed, setIncludeClosed] = useState(false);
  const tickets = useTicketsByDueDate(includeClosed);

  return (
    <div>
      <h1>Hygiene</h1>
      <p className="muted">
        Three views into work that needs cleanup. Click any ticket to open in
        Jira.
      </p>

      <h2>
        Epics without initiative{" "}
        {epics.data && (
          <span className="pill bad">{epics.data.length}</span>
        )}
      </h2>
      <EpicsNoInitiativeTable rows={epics.data ?? []} loading={epics.isLoading} />

      <h2>
        Tasks without epic{" "}
        {tasks.data && (
          <span className="pill warn">{tasks.data.length}</span>
        )}
      </h2>
      <TasksNoEpicTable rows={tasks.data ?? []} loading={tasks.isLoading} />

      <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>By due date <span className="muted small">(ascending — urgent first)</span></span>
        <label
          style={{
            fontSize: "var(--font-size-sm)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          Include closed-late
        </label>
      </h2>
      <TicketsByDueTable rows={tickets.data ?? []} loading={tickets.isLoading} />
    </div>
  );
}

// ---------- Tables ----------------------------------------------------------

function EpicsNoInitiativeTable({
  rows,
  loading,
}: {
  rows: EpicNoInitiativeRow[];
  loading: boolean;
}) {
  if (loading) return <div className="muted">Loading…</div>;
  if (rows.length === 0) return <div className="muted">All clean — every epic has an initiative.</div>;
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      <table className="datatable">
        <thead><tr>
          <th>Epic</th>
          <th>Summary</th>
          <th>Due</th>
          <th>Open SP</th>
          <th>Last activity</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.issue_key}>
              <td><JiraLink issueKey={r.issue_key} /></td>
              <td>{r.summary}</td>
              <td>{r.due_date ?? <span className="muted">—</span>}</td>
              <td>{r.sp_open || 0}</td>
              <td className="muted small">
                {r.days_since_activity == null ? "—" : `${r.days_since_activity}d ago`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TasksNoEpicTable({
  rows,
  loading,
}: {
  rows: TaskNoEpicRow[];
  loading: boolean;
}) {
  if (loading) return <div className="muted">Loading…</div>;
  if (rows.length === 0) return <div className="muted">All clean — every open task has an epic.</div>;
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      <table className="datatable">
        <thead><tr>
          <th>Ticket</th>
          <th>Type</th>
          <th>Summary</th>
          <th>Assignee</th>
          <th>Status</th>
          <th>Updated</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, 50).map((r) => (
            <tr key={r.issue_key}>
              <td><JiraLink issueKey={r.issue_key} /></td>
              <td>{r.issue_type}</td>
              <td>{r.summary.length > 50 ? r.summary.slice(0, 50) + "…" : r.summary}</td>
              <td>{r.assignee_display_name ?? <span className="muted">unassigned</span>}</td>
              <td>{r.status}</td>
              <td className="muted small">
                {new Date(r.updated_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </td>
            </tr>
          ))}
          {rows.length > 50 && (
            <tr>
              <td colSpan={6} className="muted small">… {rows.length - 50} more</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TicketsByDueTable({
  rows,
  loading,
}: {
  rows: TicketByDueRow[];
  loading: boolean;
}) {
  if (loading) return <div className="muted">Loading…</div>;
  if (rows.length === 0)
    return (
      <div className="muted">
        No tickets with due dates. (Add a due date in Jira and it'll show here.)
      </div>
    );
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      <table className="datatable">
        <thead><tr>
          <th>Ticket</th>
          <th>Summary</th>
          <th>Assignee</th>
          <th>Due</th>
          <th>Days</th>
          <th>Status</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.issue_key}>
              <td><JiraLink issueKey={r.issue_key} /></td>
              <td>{r.summary.length > 40 ? r.summary.slice(0, 40) + "…" : r.summary}</td>
              <td>{r.assignee_display_name ?? <span className="muted">—</span>}</td>
              <td>{r.due_date}</td>
              <td>
                <span className={`pill ${r.band === "grey" ? "neutral" : r.band === "red" ? "bad" : r.band === "yellow" ? "warn" : "good"}`}>
                  {r.days_to_due >= 0 ? `+${r.days_to_due}` : r.days_to_due}d
                </span>
              </td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
