/**
 * One ticket on the standup board. Click anywhere except the Jira-link
 * chip opens the notes popover; the chip itself opens Jira in a new tab.
 */

import type { Issue } from "../../api/types";
import { JiraLink } from "../../lib/jira";

function initials(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

interface Props {
  issue: Issue;
  assigneeName: string | null;
  noteCount: number;
  onClick: () => void;
}

export default function TicketCard({
  issue,
  assigneeName,
  noteCount,
  onClick,
}: Props) {
  return (
    <div
      onClick={(e) => {
        // Don't trigger card-click when the user clicked the Jira-key chip.
        const target = e.target as HTMLElement;
        if (target.closest("a")) return;
        onClick();
      }}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-2) var(--space-3)",
        marginBottom: "var(--space-2)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <JiraLink issueKey={issue.issue_key} />
        {noteCount > 0 && (
          <span
            title={`${noteCount} open note${noteCount === 1 ? "" : "s"}`}
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-accent)",
              background: "var(--color-accent-bg)",
              padding: "1px 6px",
              borderRadius: 999,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            📝 {noteCount}
          </span>
        )}
      </div>
      <div style={{ fontSize: "var(--font-size-sm)", lineHeight: 1.3 }}>
        {truncate(issue.summary, 80)}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          marginTop: 2,
        }}
      >
        <span title={assigneeName ?? "unassigned"}>
          {initials(assigneeName)}
        </span>
        {issue.story_points != null && (
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
            }}
          >
            {issue.story_points} SP
          </span>
        )}
      </div>
    </div>
  );
}
