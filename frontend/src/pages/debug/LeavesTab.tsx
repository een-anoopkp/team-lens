import { useState } from "react";
import {
  useCreateLeave,
  useDeleteLeave,
  useLeaves,
  usePeople,
} from "../../api";
import DataTable, { type Column } from "../../components/DataTable";
import type { Leave } from "../../api/types";

export default function LeavesTab() {
  const { data: leaves = [], isLoading } = useLeaves();
  const { data: people = [] } = usePeople();
  const create = useCreateLeave();
  const remove = useDeleteLeave();

  const [form, setForm] = useState({
    person_account_id: "",
    start_date: "",
    end_date: "",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.person_account_id || !form.start_date || !form.end_date) {
      setError("Person, start, and end dates required.");
      return;
    }
    try {
      await create.mutateAsync({
        person_account_id: form.person_account_id,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason || undefined,
      });
      setForm({ person_account_id: "", start_date: "", end_date: "", reason: "" });
    } catch (e: unknown) {
      const detail = (e as { detail?: { message?: string } }).detail;
      setError(detail?.message ?? `Create failed: ${String(e)}`);
    }
  };

  const columns: Column<Leave>[] = [
    {
      key: "person",
      label: "Person",
      sortValue: (r) => r.person_display_name ?? r.person_account_id,
      render: (r) => r.person_display_name ?? <code>{r.person_account_id}</code>,
    },
    {
      key: "start",
      label: "Start",
      sortValue: (r) => r.start_date,
      render: (r) => r.start_date,
    },
    {
      key: "end",
      label: "End",
      sortValue: (r) => r.end_date,
      render: (r) => r.end_date,
    },
    {
      key: "reason",
      label: "Reason",
      render: (r) => r.reason ?? <em style={{ color: "#999" }}>—</em>,
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <button
          type="button"
          onClick={() => remove.mutate(r.id)}
          style={{
            padding: "2px 8px",
            fontSize: 12,
            color: "var(--color-bad)",
            background: "transparent",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      ),
      width: 80,
    },
  ];

  return (
    <div>
      <form
        onSubmit={submit}
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: 16,
          padding: 12,
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Person</span>
          <select
            value={form.person_account_id}
            onChange={(e) => setForm({ ...form, person_account_id: e.target.value })}
            style={{ padding: 6, minWidth: 180 }}
          >
            <option value="">— select —</option>
            {people.map((p) => (
              <option key={p.account_id} value={p.account_id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Start</span>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            style={{ padding: 6 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>End</span>
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            style={{ padding: 6 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Reason (optional)</span>
          <input
            type="text"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="vacation / sick / …"
            style={{ padding: 6 }}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            background: "var(--color-accent)",
            color: "white",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: create.isPending ? "wait" : "pointer",
          }}
        >
          {create.isPending ? "Adding…" : "Add leave"}
        </button>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            padding: 8,
            marginBottom: 12,
            background: "var(--color-bad-bg)",
            color: "var(--color-bad)",
            borderRadius: "var(--radius-sm)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <DataTable
          rows={leaves}
          columns={columns}
          rowKey={(r) => String(r.id)}
          initialSort={{ key: "start", dir: "asc" }}
          searchableField={(r) =>
            `${r.person_display_name ?? ""} ${r.person_account_id} ${r.reason ?? ""}`
          }
          emptyMessage="No leaves recorded yet. Add one above."
        />
      )}
    </div>
  );
}
