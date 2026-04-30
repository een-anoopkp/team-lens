/**
 * Shared leaves-during-sprint panel — used by both the active Sprint
 * Health page and the closed-sprint accordions. Renders one warn-toned
 * pill per affected person with their total days off in the sprint
 * window. Hidden when nobody is on leave.
 */

import { useMemo } from "react";

import { useLeavesInRange } from "../../api";
import InfoIcon from "../../components/InfoIcon";

export default function SprintLeavesPanel({
  sprint,
  variant = "default",
}: {
  sprint: { start_date?: string | null; end_date?: string | null };
  /** "default" — full panel with border (active sprint).
   *  "compact" — inline, no border (closed-sprint accordions). */
  variant?: "default" | "compact";
}) {
  const from = sprint.start_date ? sprint.start_date.slice(0, 10) : null;
  const to = sprint.end_date ? sprint.end_date.slice(0, 10) : null;
  const { data, isLoading } = useLeavesInRange(from, to);

  const grouped = useMemo(() => {
    const m = new Map<
      string,
      {
        name: string;
        leaves: { start: string; end: string; reason: string | null }[];
      }
    >();
    for (const l of data ?? []) {
      const key = l.person_account_id;
      const name = l.person_display_name ?? key;
      if (!m.has(key)) m.set(key, { name, leaves: [] });
      m.get(key)!.leaves.push({
        start: l.start_date,
        end: l.end_date,
        reason: l.reason,
      });
    }
    return Array.from(m.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [data]);

  if (isLoading) return null;
  if (grouped.length === 0) return null;

  const isCompact = variant === "compact";

  return (
    <div
      className={isCompact ? undefined : "panel"}
      style={
        isCompact
          ? {
              marginTop: "var(--space-2)",
              marginBottom: "var(--space-3)",
            }
          : {
              marginBottom: "var(--space-4)",
              borderLeft: "4px solid var(--color-accent)",
            }
      }
    >
      <h3
        style={{
          marginTop: 0,
          fontSize: isCompact
            ? "var(--font-size-sm)"
            : "var(--font-size-md)",
          textTransform: isCompact ? "uppercase" : undefined,
          letterSpacing: isCompact ? "0.4px" : undefined,
          color: isCompact ? "var(--color-text-muted)" : undefined,
        }}
      >
        Leaves during this sprint{" "}
        <span className="muted small">({grouped.length} people)</span>{" "}
        <InfoIcon text="Anyone away during the sprint window. Velocity calculations already factor in available days, so this panel exists for visibility only — it doesn't double-count capacity." />
      </h3>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          marginTop: "var(--space-1)",
        }}
      >
        {grouped.map((g) => {
          const totalDays = g.leaves.reduce((sum, l) => {
            const d =
              Math.floor(
                (new Date(l.end).getTime() - new Date(l.start).getTime()) /
                  86_400_000,
              ) + 1;
            return sum + d;
          }, 0);
          const ranges = g.leaves
            .map((l) => `${l.start.slice(5)} → ${l.end.slice(5)}`)
            .join(", ");
          return (
            <span
              key={g.name}
              title={
                ranges + (g.leaves[0].reason ? ` · ${g.leaves[0].reason}` : "")
              }
              className="pill warn"
              style={{ cursor: "help" }}
            >
              {g.name} · {totalDays}d
            </span>
          );
        })}
      </div>
    </div>
  );
}
