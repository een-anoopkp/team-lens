/**
 * Standup Board — five-column Kanban for the active sprint.
 *
 * Read-only view (status changes still happen in Jira). Click a card
 * to open the notes popover. Sub-tasks are filtered out by default.
 */

import { useMemo, useState } from "react";

import {
  useActiveSprint,
  useIssues,
  useNotesCounts,
  usePeople,
} from "../../api";
import type { Issue } from "../../api/types";
import NotesPopover from "./NotesPopover";
import TicketCard from "./TicketCard";
import { COLUMNS, type ColumnId, statusToColumn } from "./columns";

export default function StandupBoard() {
  const { data: sprint, isLoading: sprintLoading } = useActiveSprint();
  const sprintId = sprint?.sprint_id;
  const { data: issuesPage, isLoading: issuesLoading } = useIssues({
    sprint_id: sprintId,
    limit: 200,
  });
  const { data: people } = usePeople();
  const { data: noteCounts } = useNotesCounts(sprintId);

  const [openIssueKey, setOpenIssueKey] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(""); // "" = everyone

  // assignee_id → display_name lookup
  const peopleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people ?? []) m.set(p.account_id, p.display_name);
    return m;
  }, [people]);

  // Only people who actually have a non-subtask in the active sprint show
  // up in the filter — keeps the dropdown short + useful.
  const sprintAssignees = useMemo(() => {
    const ids = new Set<string>();
    for (const i of issuesPage?.issues ?? []) {
      if (i.issue_type === "Sub-task") continue;
      if (i.assignee_id) ids.add(i.assignee_id);
    }
    const list: { account_id: string; display_name: string }[] = [];
    for (const id of ids) {
      list.push({
        account_id: id,
        display_name: peopleById.get(id) ?? id,
      });
    }
    list.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return list;
  }, [issuesPage, peopleById]);

  const visibleIssues = useMemo(() => {
    const issues = issuesPage?.issues ?? [];
    if (!assigneeFilter) return issues;
    if (assigneeFilter === "__unassigned__") {
      return issues.filter((i) => !i.assignee_id);
    }
    return issues.filter((i) => i.assignee_id === assigneeFilter);
  }, [issuesPage, assigneeFilter]);

  // Bucket issues by column. Sub-tasks excluded — they clutter the board.
  // Honors the assignee filter via `visibleIssues`.
  const grouped = useMemo<Record<ColumnId, Issue[]>>(() => {
    const out: Record<ColumnId, Issue[]> = {
      todo: [],
      in_progress: [],
      in_review: [],
      in_validation: [],
      done: [],
    };
    for (const i of visibleIssues) {
      if (i.issue_type === "Sub-task") continue;
      out[statusToColumn(i.status)].push(i);
    }
    // Sort each column: in_progress / in_review / in_validation first by SP desc
    // (heaviest at top — easier to spot during standup); todo/done by key.
    for (const col of Object.keys(out) as ColumnId[]) {
      out[col].sort((a, b) => {
        if (col === "todo" || col === "done") {
          return a.issue_key.localeCompare(b.issue_key);
        }
        const sa = a.story_points ?? 0;
        const sb = b.story_points ?? 0;
        return sb - sa;
      });
    }
    return out;
  }, [visibleIssues]);

  if (sprintLoading) return <div className="muted">Loading sprint…</div>;
  if (!sprint) {
    return (
      <div className="muted">
        No active sprint right now. The board reappears when the next sprint
        starts.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-3)",
          gap: "var(--space-3)",
        }}
      >
        <h2 style={{ margin: 0 }}>{sprint.name}</h2>
        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            alignItems: "center",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            Assignee
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "var(--font-size-sm)",
                fontFamily: "inherit",
              }}
            >
              <option value="">Everyone</option>
              <option value="__unassigned__">Unassigned</option>
              {sprintAssignees.map((p) => (
                <option key={p.account_id} value={p.account_id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small" style={{ whiteSpace: "nowrap" }}>
            {issuesLoading
              ? "loading…"
              : `${visibleIssues.filter((i) => i.issue_type !== "Sub-task").length} tickets`}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))`,
          gap: "var(--space-3)",
          alignItems: "flex-start",
        }}
      >
        {COLUMNS.map((c) => (
          <div
            key={c.id}
            style={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-2)",
              minHeight: 120,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0 var(--space-1)",
                marginBottom: "var(--space-2)",
                fontSize: "var(--font-size-xs)",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                color: "var(--color-text-muted)",
                fontWeight: 600,
              }}
            >
              <span>{c.label}</span>
              <span>{grouped[c.id].length}</span>
            </div>
            {grouped[c.id].length === 0 ? (
              <div
                className="muted small"
                style={{ padding: "var(--space-2) var(--space-1)" }}
              >
                No tickets
              </div>
            ) : (
              grouped[c.id].map((issue) => (
                <TicketCard
                  key={issue.issue_key}
                  issue={issue}
                  assigneeName={
                    issue.assignee_id
                      ? peopleById.get(issue.assignee_id) ?? null
                      : null
                  }
                  noteCount={noteCounts?.[issue.issue_key] ?? 0}
                  onClick={() => setOpenIssueKey(issue.issue_key)}
                />
              ))
            )}
          </div>
        ))}
      </div>

      {openIssueKey && (
        <NotesPopover
          issueKey={openIssueKey}
          onClose={() => setOpenIssueKey(null)}
        />
      )}
    </div>
  );
}
