import { useRunSync, useSyncStatus } from "../api";

export default function RefreshButton() {
  const { data } = useSyncStatus();
  const run = useRunSync();
  const running = !!data?.is_running || run.isPending;

  return (
    <button
      type="button"
      onClick={() => run.mutate("incremental")}
      disabled={running}
      style={{
        padding: "6px 12px",
        fontSize: 13,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
        cursor: running ? "wait" : "pointer",
      }}
      title="Trigger an incremental sync"
    >
      {running ? "↻ Syncing…" : "↻ Refresh"}
    </button>
  );
}
