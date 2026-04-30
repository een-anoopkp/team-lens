import { useSyncStatus } from "../api";

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function StalenessBadge() {
  const { data } = useSyncStatus();
  if (!data) return null;

  const last = data.last_success_at;
  let tone: "good" | "warn" | "bad" | "neutral" = "neutral";
  let text = "never synced";
  if (last) {
    const ms = Date.now() - new Date(last).getTime();
    const hours = ms / 3_600_000;
    if (hours <= 24) tone = "good";
    else if (hours <= 72) tone = "warn";
    else tone = "bad";
    text = `Synced ${formatRelative(last)}`;
  }

  if (data.is_running) {
    tone = "neutral";
    text = "Syncing…";
  }

  const colors = {
    good: { bg: "var(--color-good-bg)", fg: "var(--color-good)" },
    warn: { bg: "var(--color-warn-bg)", fg: "var(--color-warn)" },
    bad: { bg: "var(--color-bad-bg)", fg: "var(--color-bad)" },
    neutral: { bg: "rgba(0,0,0,0.06)", fg: "var(--color-text-muted)" },
  }[tone];

  return (
    <span
      style={{
        background: colors.bg,
        color: colors.fg,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      title={last ? `Last successful sync: ${last}` : "No successful sync yet"}
    >
      {text}
    </span>
  );
}
