/**
 * Notes — global view of every open standup follow-up across every
 * ticket. Each row shows the note body and the EEPD ticket key beside
 * it (clickable Jira link). Toggle the checkbox to mark done; × to
 * delete. "Show done" toggles include the closed ones too.
 *
 * This page is the "single inbox" for follow-ups so they don't get
 * forgotten between ticket views.
 */

import { useMemo, useState } from "react";

import { useAllNotes, useDeleteNote, useUpdateNote } from "../../api";
import type { TicketNoteWithContext } from "../../api/types";
import InfoIcon from "../../components/InfoIcon";
import { JiraLink } from "../../lib/jira";

function relativeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotesPage() {
  const [includeDone, setIncludeDone] = useState(false);
  const { data, isLoading } = useAllNotes(includeDone);
  const update = useUpdateNote();
  const del = useDeleteNote();

  // Group notes by issue_key for a tidy display: one heading per ticket,
  // its open follow-ups beneath. Preserves server-side sort within group.
  const grouped = useMemo(() => {
    const out = new Map<string, TicketNoteWithContext[]>();
    for (const n of data ?? []) {
      if (!out.has(n.issue_key)) out.set(n.issue_key, []);
      out.get(n.issue_key)!.push(n);
    }
    return Array.from(out.entries());
  }, [data]);

  const totalOpen = (data ?? []).filter((n) => !n.done).length;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>
        Notes <span className="muted small">({totalOpen} open)</span>{" "}
        <InfoIcon text="Every open standup follow-up across every ticket. Notes are local-only — never written to Jira. Toggle the checkbox to close one; the × button deletes." />
      </h1>
      <p className="muted">
        Single view of every follow-up you've taken. Click the ticket key to
        open the issue in Jira.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          marginBottom: "var(--space-3)",
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "var(--font-size-sm)",
          }}
        >
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(e) => setIncludeDone(e.target.checked)}
          />
          Include done
        </label>
      </div>

      {isLoading ? (
        <div className="muted">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="muted small">
          No open follow-ups yet. Add one from any ticket on{" "}
          <code>/sprint-health/board</code>.
        </div>
      ) : (
        grouped.map(([issueKey, notes]) => (
          <div
            key={issueKey}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-3)",
              marginBottom: "var(--space-3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: "var(--space-2)",
              }}
            >
              <JiraLink issueKey={issueKey} />
              <span className="muted small">{notes[0].summary}</span>
              <span
                className="muted small"
                style={{ marginLeft: "auto", whiteSpace: "nowrap" }}
              >
                {notes[0].status}
              </span>
            </div>
            {notes.map((n) => (
              <div
                key={n.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  opacity: n.done ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={n.done}
                  onChange={(e) =>
                    update.mutate({
                      id: n.id,
                      issueKey: n.issue_key,
                      done: e.target.checked,
                    })
                  }
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: "var(--font-size-sm)",
                    textDecoration: n.done ? "line-through" : "none",
                    color: n.done
                      ? "var(--color-text-muted)"
                      : "var(--color-text)",
                  }}
                >
                  {n.body}
                </span>
                <span
                  className="muted"
                  style={{ fontSize: "var(--font-size-xs)" }}
                >
                  {n.done && n.done_at
                    ? `✓ ${relativeAgo(n.done_at)}`
                    : `+ ${relativeAgo(n.created_at)}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Delete this note?")) {
                      del.mutate({ id: n.id, issueKey: n.issue_key });
                    }
                  }}
                  title="Delete"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    fontSize: 16,
                    padding: "0 4px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
