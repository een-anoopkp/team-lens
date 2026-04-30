/**
 * Notes popover — local-only standup follow-ups for one ticket.
 *
 * Behaviour:
 *   - Opens centered over the board with a ~480px modal.
 *   - "+ Add" input at the top, autofocused. Enter or blur creates a note.
 *   - Each open note has a checkbox, editable text, and × delete button.
 *     Editing autosaves via debounced PATCH (~500ms after last keystroke).
 *     Toggling done is immediate.
 *   - Footer reveals up to 5 done items from the trailing 14 days.
 *   - Esc or backdrop click closes; pending edits flush first.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  useCreateNote,
  useDeleteNote,
  useTicketNotes,
  useUpdateNote,
} from "../../api";
import type { TicketNote } from "../../api/types";
import { JiraLink } from "../../lib/jira";

interface Props {
  issueKey: string;
  onClose: () => void;
}

const PATCH_DEBOUNCE_MS = 500;

export default function NotesPopover({ issueKey, onClose }: Props) {
  const { data, isLoading } = useTicketNotes(issueKey);
  const create = useCreateNote();
  const update = useUpdateNote();
  const del = useDeleteNote();

  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const draftRef = useRef<HTMLInputElement>(null);

  // Autofocus + close-on-Esc.
  useEffect(() => {
    draftRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submitDraft = () => {
    const body = draft.trim();
    if (!body) return;
    create.mutate({ issueKey, body });
    setDraft("");
  };

  const onDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitDraft();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-4)",
          width: 480,
          maxWidth: "90vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--space-3)",
          }}
        >
          <div style={{ fontSize: "var(--font-size-md)", fontWeight: 600 }}>
            <JiraLink issueKey={issueKey} /> · standup notes
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--color-text-muted)",
              padding: "0 var(--space-1)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* + Add input */}
        <input
          ref={draftRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submitDraft}
          onKeyDown={onDraftKeyDown}
          placeholder="+ Add a follow-up…"
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-2)",
            color: "var(--color-text)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "inherit",
            marginBottom: "var(--space-3)",
            boxSizing: "border-box",
          }}
        />

        {/* Body — open notes list */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {isLoading ? (
            <div className="muted small">Loading…</div>
          ) : (data?.open.length ?? 0) === 0 ? (
            <div className="muted small">
              No follow-ups yet — type above to add one.
            </div>
          ) : (
            data!.open.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                issueKey={issueKey}
                onPatch={(patch) =>
                  update.mutate({ id: n.id, issueKey, ...patch })
                }
                onDelete={() => del.mutate({ id: n.id, issueKey })}
              />
            ))
          )}

          {/* Done section */}
          {(data?.done_recent.length ?? 0) > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-xs)",
                  padding: "var(--space-2) 0",
                  marginTop: "var(--space-2)",
                  textAlign: "left",
                }}
              >
                {showDone ? "▾ " : "▸ "}
                {data!.done_recent.length} done in last 14d
              </button>
              {showDone &&
                data!.done_recent.map((n) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    issueKey={issueKey}
                    onPatch={(patch) =>
                      update.mutate({ id: n.id, issueKey, ...patch })
                    }
                    onDelete={() => del.mutate({ id: n.id, issueKey })}
                  />
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Single note row -------------------------------------------------------

interface RowProps {
  note: TicketNote;
  issueKey: string;
  onPatch: (patch: { body?: string; done?: boolean }) => void;
  onDelete: () => void;
}

function NoteRow({ note, onPatch, onDelete }: RowProps) {
  const [text, setText] = useState(note.body);
  const lastSaved = useRef(note.body);

  // External update (e.g. another tab) reconciles into local state.
  useEffect(() => {
    if (note.body !== lastSaved.current) {
      setText(note.body);
      lastSaved.current = note.body;
    }
  }, [note.body]);

  // Debounced autosave on text change.
  useEffect(() => {
    if (text === lastSaved.current) return;
    const t = window.setTimeout(() => {
      lastSaved.current = text;
      const trimmed = text.trim();
      if (trimmed.length === 0) return; // body required (>=1 char); ignore empty
      onPatch({ body: trimmed });
    }, PATCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const doneAgo = useMemo(() => relativeAgo(note.done_at), [note.done_at]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        opacity: note.done ? 0.7 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={note.done}
        onChange={(e) => onPatch({ done: e.target.checked })}
        style={{ flexShrink: 0 }}
      />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // Flush immediately on blur if there's a pending change.
          const trimmed = text.trim();
          if (trimmed && trimmed !== lastSaved.current) {
            lastSaved.current = trimmed;
            onPatch({ body: trimmed });
          }
        }}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          color: note.done ? "var(--color-text-muted)" : "var(--color-text)",
          fontSize: "var(--font-size-sm)",
          fontFamily: "inherit",
          textDecoration: note.done ? "line-through" : "none",
          padding: "2px 4px",
          outline: "none",
        }}
      />
      {note.done && doneAgo && (
        <span
          className="muted"
          style={{ fontSize: "var(--font-size-xs)", whiteSpace: "nowrap" }}
        >
          ✓ {doneAgo}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          if (confirm("Delete this note?")) onDelete();
        }}
        title="Delete"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--color-text-muted)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: "0 4px",
        }}
      >
        ×
      </button>
    </div>
  );
}

function relativeAgo(iso: string | null): string | null {
  if (!iso) return null;
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
