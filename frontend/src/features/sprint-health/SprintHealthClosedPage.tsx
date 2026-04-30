/**
 * Sprint Health (closed) — accordion list of the last 6 closed sprints.
 *
 * Each accordion shows: per-sprint KPIs (committed / completed / velocity /
 * carry-over) plus the per-person final breakdown. Click to expand. The
 * "Overall" row at the top averages across the 6 sprints.
 *
 * Live data, lazy-fetched per sprint via useSprintRollup. We deliberately
 * skip burnup / carry / blockers in this view to keep the network cheap;
 * those live on /sprint-health for the active sprint.
 */

import { useMemo } from "react";

import { useSprintRollup, useSprints } from "../../api";
import type { Sprint, SprintRollup } from "../../api/types";
import InfoIcon from "../../components/InfoIcon";
import SprintLeavesPanel from "./SprintLeavesPanel";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function SprintHealthClosedPage() {
  const { data: closed = [], isLoading } = useSprints("closed");

  const recent = useMemo(() => {
    return [...closed]
      .filter((s) => s.start_date)
      .sort((a, b) =>
        (b.start_date ?? "").localeCompare(a.start_date ?? "")
      )
      .slice(0, 6);
  }, [closed]);

  if (isLoading) return <div className="muted">Loading…</div>;

  return (
    <div>
      <h1>
        Sprint Health <span className="pill neutral">closed</span>
      </h1>
      <p className="muted">
        Last 6 closed sprints. Click any sprint to expand its per-sprint
        KPIs and per-person breakdown.
      </p>

      <h2>Overall <span className="muted small">(across last 6 closed)</span></h2>
      <OverallStrip sprints={recent} />

      <h2>
        Per sprint <span className="muted small">(newest first — click to expand)</span>
      </h2>
      {recent.length === 0 ? (
        <div className="muted small">
          No closed sprints in the database yet.
        </div>
      ) : (
        recent.map((s, i) => (
          <SprintAccordion key={s.sprint_id} sprint={s} defaultOpen={i === 0} />
        ))
      )}
    </div>
  );
}

// ---- Overall strip --------------------------------------------------------

function OverallStrip({ sprints }: { sprints: Sprint[] }) {
  const ids = sprints.map((s) => s.sprint_id);
  // Pull all rollups in parallel.
  const r0 = useSprintRollup(ids[0]);
  const r1 = useSprintRollup(ids[1]);
  const r2 = useSprintRollup(ids[2]);
  const r3 = useSprintRollup(ids[3]);
  const r4 = useSprintRollup(ids[4]);
  const r5 = useSprintRollup(ids[5]);
  const all = [r0, r1, r2, r3, r4, r5]
    .map((r) => r.data)
    .filter((d): d is SprintRollup => !!d);

  if (all.length === 0) {
    return <div className="muted small">Loading rollups…</div>;
  }

  const totalCommitted = all.reduce((n, r) => n + num(r.committed_sp), 0);
  const totalCompleted = all.reduce((n, r) => n + num(r.completed_sp), 0);
  // Per-sprint velocities are already SP / person-day. Mean across sprints
  // gives a stable "what does the average person deliver per working day"
  // signal regardless of headcount or leave shifts between sprints.
  const validVelocities = all
    .map((r) => num(r.velocity_sp_per_person_day))
    .filter((v) => v > 0);
  const avgVelocity =
    validVelocities.length > 0
      ? validVelocities.reduce((a, b) => a + b, 0) / validVelocities.length
      : 0;
  const avgPctDone =
    totalCommitted > 0 ? (totalCompleted / totalCommitted) * 100 : 0;

  return (
    <div className="kpi-row">
      <div className="kpi neutral">
        <div className="kpi-label">Avg velocity</div>
        <div className="kpi-value">
          {avgVelocity.toFixed(2)}{" "}
          <span className="kpi-sub">SP/day/person</span>
        </div>
        <div className="kpi-sub">across {all.length} sprints</div>
      </div>
      <div className={`kpi ${avgPctDone >= 80 ? "good" : avgPctDone >= 60 ? "warn" : "bad"}`}>
        <div className="kpi-label">Avg completion</div>
        <div className="kpi-value">{avgPctDone.toFixed(0)}%</div>
        <div className="kpi-sub">of committed</div>
      </div>
      <div className="kpi neutral">
        <div className="kpi-label">Total committed</div>
        <div className="kpi-value">{totalCommitted.toFixed(0)} SP</div>
        <div className="kpi-sub">{all.length}-sprint sum</div>
      </div>
      <div className="kpi good">
        <div className="kpi-label">Total completed</div>
        <div className="kpi-value">{totalCompleted.toFixed(0)} SP</div>
        <div className="kpi-sub">{all.length}-sprint sum</div>
      </div>
    </div>
  );
}

// ---- Per-sprint accordion -------------------------------------------------

function SprintAccordion({
  sprint,
  defaultOpen,
}: {
  sprint: Sprint;
  defaultOpen?: boolean;
}) {
  const rollup = useSprintRollup(sprint.sprint_id);
  const data = rollup.data;

  const completedPct =
    data && num(data.committed_sp) > 0
      ? (num(data.completed_sp) / num(data.committed_sp)) * 100
      : 0;
  const tone =
    completedPct >= 80 ? "good" : completedPct >= 60 ? "warn" : "bad";

  return (
    <details className="sprint-accordion" open={defaultOpen}>
      <summary>
        <span className="sprint-acc-name">{sprint.name}</span>
        <span className="sprint-acc-meta">
          <span className="muted small">
            Closed {fmtDate(sprint.complete_date ?? sprint.end_date)} ·{" "}
            {data ? `${data.days_total} days` : "…"}
          </span>
          <span className={`pill ${tone}`}>
            {data ? `${completedPct.toFixed(0)}% done` : "…"}
          </span>
          <span className="muted small">
            velocity{" "}
            {data
              ? num(data.velocity_sp_per_person_day).toFixed(2)
              : "…"}{" "}
            SP/day/person
          </span>
        </span>
      </summary>
      <div className="sprint-acc-body">
        {!data ? (
          <div className="muted small">Loading sprint rollup…</div>
        ) : (
          <SprintBody data={data} sprint={sprint} />
        )}
      </div>
    </details>
  );
}

function SprintBody({
  data,
  sprint,
}: {
  data: SprintRollup;
  sprint: Sprint;
}) {
  const completedPct =
    num(data.committed_sp) > 0
      ? (num(data.completed_sp) / num(data.committed_sp)) * 100
      : 0;
  const tone =
    completedPct >= 80 ? "good" : completedPct >= 60 ? "warn" : "bad";
  return (
    <>
      <div className="kpi-row">
        <div className="kpi neutral">
          <div className="kpi-label">Committed</div>
          <div className="kpi-value">{num(data.committed_sp).toFixed(0)} SP</div>
        </div>
        <div className={`kpi ${tone}`}>
          <div className="kpi-label">Completed</div>
          <div className="kpi-value">{num(data.completed_sp).toFixed(0)} SP</div>
          <div className="kpi-sub">{completedPct.toFixed(0)}%</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">
            Velocity{" "}
            <InfoIcon
              text={
                "Completed SP ÷ Person-days. Both numerator and denominator " +
                "use the elapsed window for active sprints, so the value " +
                "isn't biased by remaining capacity. Cross-sprint " +
                "comparisons hold even when headcount or leaves shift."
              }
            />
          </div>
          <div className="kpi-value">
            {num(data.velocity_sp_per_person_day).toFixed(2)}{" "}
            <span className="kpi-sub">SP/day/person</span>
          </div>
        </div>
        <PersonDaysTileClosed data={data} />
      </div>
      <SprintLeavesPanel sprint={sprint} variant="compact" />
      <h3>Per-person final</h3>
      <div className="panel">
        {data.per_person.length === 0 ? (
          <div className="muted small">No per-person data.</div>
        ) : (
          [...data.per_person]
            .sort(
              (a, b) =>
                num(b.completed_sp) - num(a.completed_sp) ||
                num(b.committed_sp) - num(a.committed_sp)
            )
            .map((p) => {
              const pct =
                num(p.committed_sp) > 0
                  ? (num(p.completed_sp) / num(p.committed_sp)) * 100
                  : 0;
              return (
                <div className="proto-row" key={p.person_account_id}>
                  <div className="proto-label">
                    {p.person_display_name ?? p.person_account_id}
                  </div>
                  <div className="progress-track">
                    <span
                      className="seg seg-done"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    <span
                      className="seg seg-todo"
                      style={{ width: `${Math.max(0, 100 - pct)}%` }}
                    />
                  </div>
                  <div className="proto-num">
                    {num(p.completed_sp).toFixed(0)} /{" "}
                    {num(p.committed_sp).toFixed(0)} ·{" "}
                    {pct.toFixed(0)}%
                  </div>
                </div>
              );
            })
        )}
      </div>
    </>
  );
}

function PersonDaysTileClosed({ data }: { data: SprintRollup }) {
  const personDaysTotal = data.per_person.reduce(
    (n, p) => n + (p.available_days ?? 0),
    0,
  );
  const headcount = data.per_person.length;
  const naiveCapacity = headcount * data.days_total;
  const leaveDaysLost = Math.max(0, naiveCapacity - personDaysTotal);
  return (
    <div className="kpi neutral">
      <div className="kpi-label">
        Person-days{" "}
        <InfoIcon
          text={
            "Cumulative working days available to the team across the sprint. " +
            "Computed as Σ over each team member of (sprint weekdays − team " +
            "holidays − that person's leaves). Drives Velocity's denominator."
          }
        />
      </div>
      <div className="kpi-value">{personDaysTotal}</div>
      <div className="kpi-sub">
        {headcount} ppl × {data.days_total} d
        {leaveDaysLost > 0 ? ` − ${leaveDaysLost} leave d` : null}
      </div>
    </div>
  );
}
