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

function formatNextRun(iso: string): string {
  const target = new Date(iso);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const sameDay =
    target.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = target.toDateString() === tomorrow.toDateString();

  const hhmm = target.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (diffMs < 0) return `overdue · was ${hhmm}`;
  if (sameDay) return `today ${hhmm}`;
  if (isTomorrow) return `tomorrow ${hhmm}`;
  return target.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  const nextIncremental = data.scheduled?.find(
    (j) => j.id === "sync_incremental"
  )?.next_run_at;
  const nextFull = data.scheduled?.find((j) => j.id === "sync_full")
    ?.next_run_at;
  const titleLines = [
    last ? `Last successful sync: ${last}` : "No successful sync yet",
    nextIncremental
      ? `Next incremental: ${new Date(nextIncremental).toLocaleString()}`
      : "Scheduler: not running",
    nextFull
      ? `Next full scan:    ${new Date(nextFull).toLocaleString()}`
      : null,
  ].filter(Boolean);

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        background: colors.bg,
        color: colors.fg,
        padding: "4px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
      title={titleLines.join("\n")}
    >
      <span>{text}</span>
      {nextIncremental && (
        <span style={{ fontSize: 10, opacity: 0.75, fontWeight: 400 }}>
          Next: {formatNextRun(nextIncremental)}
        </span>
      )}
    </span>
  );
}
