/**
 * Sprint Health page — Phase 3.2.
 *
 * Replaces the Phase-1 placeholder. Implements the Phase-2 mockup against
 * live data via TanStack Query hooks. No new endpoints needed (everything
 * is in Phase 3.1).
 *
 * Layout:
 *   1. SprintBanner (active or "no active — viewing closed N")
 *   2. KPI row (committed / done / velocity / projected)
 *   3. Hygiene inline counts
 *   4. Burnup chart
 *   5. Per-person table with segmented progress + accuracy
 *   6. 6-sprint velocity trend
 *   7. Three-panel: carry-over / scope churn / blockers
 */

import { useMemo } from "react";

import {
  useActiveSprint,
  useBlockers,
  useBurnup,
  useCarryOver,
  useSprintRollup,
  useSprints,
  useVelocity,
} from "../../api";
import type {
  BlockerRow,
  BurnupResponse,
  CarryOverRow,
  PersonRollup,
  SprintRollup,
  StatusBreakdown,
  VelocityRow,
} from "../../api/types";
import { JiraLink } from "../../lib/jira";

// ---------- Number / decimal helpers -----------------------------------------

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function fmtSp(v: string | number | null | undefined, dp = 0): string {
  const n = num(v);
  return n.toFixed(dp);
}

function pct(v: string | number | null | undefined): string {
  const n = num(v);
  return `${Math.round(n * 100)}%`;
}

// ---------- Page -------------------------------------------------------------

export default function SprintHealthPage() {
  const { data: active, isLoading: activeLoading } = useActiveSprint();
  const { data: closed = [] } = useSprints("closed");

  // If no active sprint, show the most recent closed (per Phase 2 inputs).
  const fallbackClosed = useMemo(() => {
    if (active) return null;
    return [...closed].sort((a, b) => {
      if (!a.start_date || !b.start_date) return 0;
      return b.start_date.localeCompare(a.start_date);
    })[0];
  }, [active, closed]);

  const sprint = active ?? fallbackClosed ?? null;
  const sprintId = sprint?.sprint_id;
  const isActive = !!active;

  const rollup = useSprintRollup(sprintId);
  const burnup = useBurnup(sprintId);
  const carry = useCarryOver(sprintId);
  const blockers = useBlockers(sprintId);
  const velocity = useVelocity(6);

  if (activeLoading) {
    return <div className="muted">Loading sprint…</div>;
  }
  if (!sprint) {
    return (
      <div>
        <h1>Sprint Health</h1>
        <div className="state-panel">
          <h4>No sprints synced yet</h4>
          <p className="muted small">
            Click <strong>↻ Refresh</strong> in the top bar to run your first
            sync.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Sprint Health</h1>

      <SprintBanner sprint={sprint} isActive={isActive} rollup={rollup.data} />

      {rollup.isLoading ? (
        <p className="muted">Loading KPIs…</p>
      ) : rollup.data ? (
        <>
          <h2>Team KPIs</h2>
          <KpiRow rollup={rollup.data} isActive={isActive} />
        </>
      ) : null}

      {burnup.data && burnup.data.points.length > 0 && (
        <>
          <h2>Burnup</h2>
          <BurnupChart data={burnup.data} />
        </>
      )}

      {rollup.data && rollup.data.per_person.length > 0 && (
        <>
          <h2>
            Per-person{" "}
            <span className="muted small">({rollup.data.per_person.length} people)</span>
          </h2>
          <PerPersonPanel people={rollup.data.per_person} />
        </>
      )}

      {velocity.data && velocity.data.length > 0 && (
        <>
          <h2>6-sprint velocity trend</h2>
          <VelocityTrend rows={velocity.data} />
        </>
      )}

      <h2>Carry-over · scope churn · blockers</h2>
      <div className="three-panel">
        <CarryOverPanel rows={carry.data ?? []} loading={carry.isLoading} />
        <ScopeChurnPanel sprintId={sprintId} />
        <BlockersPanel rows={blockers.data ?? []} loading={blockers.isLoading} />
      </div>
    </div>
  );
}

// ---------- Sub-components ---------------------------------------------------

function SprintBanner({
  sprint,
  isActive,
  rollup,
}: {
  sprint: { sprint_id: number; name: string; end_date?: string | null; complete_date?: string | null };
  isActive: boolean;
  rollup: SprintRollup | undefined;
}) {
  const dateLabel = isActive
    ? sprint.end_date
      ? `ends ${new Date(sprint.end_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : ""
    : sprint.complete_date
      ? `closed ${new Date(sprint.complete_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
      : "";

  const daysRemaining = rollup?.days_remaining ?? null;

  return (
    <div className={`sprint-banner ${isActive ? "sprint-banner-active" : "sprint-banner-closed"}`}>
      <strong>{sprint.name}</strong>
      {" · "}
      {isActive ? "Active" : "Closed"}
      {dateLabel && ` · ${dateLabel}`}
      {isActive && daysRemaining != null && daysRemaining > 0 && (
        <>
          {" · "}
          <span className="muted">{daysRemaining} day{daysRemaining === 1 ? "" : "s"} left</span>
        </>
      )}
      {!isActive && (
        <span className="muted small" style={{ marginLeft: 12 }}>
          (no active sprint right now — viewing most recent closed)
        </span>
      )}
      {rollup && (
        <span style={{ float: "right" }} className="muted small">
          Hygiene: {rollup.hygiene.unassigned} unassigned · {rollup.hygiene.missing_sp} missing SP · {rollup.hygiene.missing_epic} missing epic
        </span>
      )}
    </div>
  );
}

function KpiRow({ rollup, isActive }: { rollup: SprintRollup; isActive: boolean }) {
  const committed = num(rollup.committed_sp);
  const completed = num(rollup.completed_sp);
  const completionPct = committed > 0 ? completed / committed : 0;
  const projected = num(rollup.projected_sp);

  return (
    <div className="kpi-row">
      <div className="kpi neutral">
        <div className="kpi-label">Committed</div>
        <div className="kpi-value">{fmtSp(committed)} SP</div>
        <div className="kpi-sub">{rollup.per_person.length} people</div>
      </div>
      <div className={`kpi ${completionPct >= 0.85 ? "good" : completionPct >= 0.6 ? "warn" : "bad"}`}>
        <div className="kpi-label">Done</div>
        <div className="kpi-value">{fmtSp(completed)} SP</div>
        <div className="kpi-sub">{committed > 0 ? pct(completionPct) : "—"}</div>
      </div>
      <div className="kpi neutral">
        <div className="kpi-label">Velocity</div>
        <div className="kpi-value">
          {rollup.velocity_sp_per_day != null ? fmtSp(rollup.velocity_sp_per_day, 1) : "—"} <span className="kpi-sub">SP/day</span>
        </div>
        <div className="kpi-sub">
          {rollup.days_elapsed} of {rollup.days_total} days elapsed
        </div>
      </div>
      <div className={`kpi ${isActive ? (projected >= committed * 0.9 ? "good" : "warn") : "neutral"}`}>
        <div className="kpi-label">{isActive ? "Projected" : "Carry-over"}</div>
        <div className="kpi-value">
          {isActive ? `${fmtSp(projected)} SP` : `${fmtSp(committed - completed)} SP`}
        </div>
        <div className="kpi-sub">
          {isActive
            ? committed > 0 && projected >= committed * 0.9 ? "on track" : projected > 0 ? "below committed" : "—"
            : `${rollup.per_person.length} active people`}
        </div>
      </div>
    </div>
  );
}

function BurnupChart({ data }: { data: BurnupResponse }) {
  const { points } = data;
  if (points.length === 0) return null;
  const target = num(data.target_sp);
  const maxY = Math.max(target, ...points.map((p) => num(p.cumulative_done_sp)), 1);
  const w = 600;
  const h = 160;
  const margin = { left: 10, right: 10, top: 20, bottom: 20 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;
  const xStep = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const polyline = points
    .map((p, i) => {
      const x = margin.left + i * xStep;
      const y = margin.top + innerH * (1 - num(p.cumulative_done_sp) / maxY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const targetY = margin.top + innerH * (1 - target / maxY);

  return (
    <div className="chart-panel">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="chart">
        <line x1="0" y1={targetY} x2={w} y2={targetY} className="chart-target" strokeDasharray="4 4" />
        <text x="6" y={targetY - 4} className="chart-label">target {fmtSp(target)} SP</text>
        <polyline className="chart-line" points={polyline} />
        <g className="chart-axis">
          {points.length > 0 && (
            <>
              <text x={margin.left} y={h - 4}>
                {points[0].day.slice(5)}
              </text>
              <text x={w - margin.right - 30} y={h - 4}>
                {points[points.length - 1].day.slice(5)}
              </text>
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

function PerPersonPanel({ people }: { people: PersonRollup[] }) {
  // Sort by velocity desc
  const sorted = useMemo(
    () =>
      [...people].sort(
        (a, b) => num(b.velocity) - num(a.velocity)
      ),
    [people]
  );

  return (
    <div className="panel">
      {sorted.map((p) => (
        <PerPersonRow key={p.person_account_id} p={p} />
      ))}
      <div className="legend">
        <span className="legend-item"><span className="seg seg-done" /> Done</span>
        <span className="legend-item"><span className="seg seg-valid" /> Validation</span>
        <span className="legend-item"><span className="seg seg-review" /> Review</span>
        <span className="legend-item"><span className="seg seg-prog" /> In progress</span>
        <span className="legend-item"><span className="seg seg-todo" /> To do</span>
      </div>
    </div>
  );
}

function PerPersonRow({ p }: { p: PersonRollup }) {
  const sb: StatusBreakdown = p.status_breakdown;
  const total =
    num(sb.todo_sp) +
    num(sb.in_progress_sp) +
    num(sb.review_sp) +
    num(sb.validation_sp) +
    num(sb.done_sp);
  const pctOf = (v: string | number) => (total > 0 ? (num(v) / total) * 100 : 0);

  const accuracyValue = num(p.accuracy);
  const accuracyTone =
    p.accuracy == null
      ? null
      : accuracyValue >= 0.85
        ? "good"
        : accuracyValue >= 0.6
          ? "warn"
          : "bad";

  return (
    <div className="proto-row">
      <div className="proto-label">{p.person_display_name ?? p.person_account_id}</div>
      <div className="progress-track">
        <span className="seg seg-done"   style={{ width: `${pctOf(sb.done_sp)}%` }} />
        <span className="seg seg-valid"  style={{ width: `${pctOf(sb.validation_sp)}%` }} />
        <span className="seg seg-review" style={{ width: `${pctOf(sb.review_sp)}%` }} />
        <span className="seg seg-prog"   style={{ width: `${pctOf(sb.in_progress_sp)}%` }} />
        <span className="seg seg-todo"   style={{ width: `${pctOf(sb.todo_sp)}%` }} />
      </div>
      <div className="proto-num">
        {fmtSp(p.completed_sp)} / {fmtSp(p.committed_sp)} SP
        {p.velocity != null && ` · ${fmtSp(p.velocity, 1)}/day`}
        {p.accuracy != null && ` · ${pct(p.accuracy)}`}
        {accuracyTone && accuracyTone !== "good" && (
          <span className={`pill ${accuracyTone}`} style={{ marginLeft: 4 }}>⚠</span>
        )}
      </div>
    </div>
  );
}

function VelocityTrend({ rows }: { rows: VelocityRow[] }) {
  // Group by sprint, compute team average velocity per sprint
  const bySprintAvg = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const r of rows) {
      if (r.velocity == null) continue;
      const v = num(r.velocity);
      if (!grouped.has(r.sprint_name)) grouped.set(r.sprint_name, []);
      grouped.get(r.sprint_name)!.push(v);
    }
    return Array.from(grouped.entries())
      .map(([name, velocities]) => ({
        name,
        avg: velocities.reduce((a, b) => a + b, 0) / velocities.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  if (bySprintAvg.length === 0) return null;
  const w = 600;
  const h = 120;
  const margin = { left: 10, right: 10, top: 10, bottom: 20 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;
  const maxY = Math.max(...bySprintAvg.map((s) => s.avg), 1);
  const xStep = bySprintAvg.length > 1 ? innerW / (bySprintAvg.length - 1) : innerW;
  const polyline = bySprintAvg
    .map((s, i) => {
      const x = margin.left + i * xStep;
      const y = margin.top + innerH * (1 - s.avg / maxY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="chart-panel">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="chart">
        <polyline className="chart-line" points={polyline} />
        <g className="chart-axis">
          {bySprintAvg.map((s, i) => (
            <text
              key={s.name}
              x={margin.left + i * xStep}
              y={h - 4}
              textAnchor="middle"
            >
              {s.name.replace("Search ", "")}
            </text>
          ))}
        </g>
      </svg>
      <div className="legend">
        <span className="legend-item">
          <svg width="20" height="3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke="var(--color-accent)" strokeWidth="2" /></svg>
          Team avg velocity (SP/day)
        </span>
      </div>
    </div>
  );
}

function CarryOverPanel({ rows, loading }: { rows: CarryOverRow[]; loading: boolean }) {
  return (
    <div className="panel">
      <h3>Carry-over</h3>
      {loading ? (
        <p className="muted small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No carry-overs.</p>
      ) : (
        <>
          <p className="muted small">
            {rows.length} ticket{rows.length === 1 ? "" : "s"} · max depth {Math.max(...rows.map((r) => r.depth))} sprints
          </p>
          <table className="datatable">
            <tbody>
              {rows.slice(0, 10).map((r) => (
                <tr key={r.issue_key}>
                  <td><JiraLink issueKey={r.issue_key} /></td>
                  <td>{r.assignee_display_name ?? "—"}</td>
                  <td>
                    <span className={`pill ${r.depth >= 3 ? "bad" : "warn"}`}>d{r.depth}</span>
                  </td>
                </tr>
              ))}
              {rows.length > 10 && (
                <tr><td colSpan={3} className="muted small">… {rows.length - 10} more</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ScopeChurnPanel({ sprintId }: { sprintId: number | undefined }) {
  // Lazy-loaded inside the panel so it doesn't block the page
  // Expected to land via /metrics/scope-changes filtered by sprint_id
  return (
    <div className="panel">
      <h3>Scope churn</h3>
      {sprintId == null ? (
        <p className="muted small">No sprint selected.</p>
      ) : (
        <ScopeChurnLoader sprintId={sprintId} />
      )}
    </div>
  );
}

interface ScopeChangeShape {
  issue_key: string;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  sp_delta: string | number | null;
}

function ScopeChurnLoader({ sprintId }: { sprintId: number }) {
  // Sprint-scoped fetch — no typed hook yet.
  const rows = useStateAsync<ScopeChangeShape[]>(
    `/api/v1/metrics/scope-changes?sprint_id=${sprintId}&limit=50`
  );

  if (!rows) return <p className="muted small">Loading…</p>;
  if (rows.length === 0) return <p className="muted small">No scope changes detected.</p>;

  const added = rows.filter((r) => r.change_type === "sp" && num(r.sp_delta) > 0);
  const removed = rows.filter((r) => r.change_type === "sp" && num(r.sp_delta) < 0);
  const midSprint = rows.filter((r) => r.change_type === "added_mid_sprint");

  return (
    <>
      <p className="muted small">
        +{added.reduce((s, r) => s + num(r.sp_delta), 0).toFixed(0)} SP added ·
        {" "}{Math.abs(removed.reduce((s, r) => s + num(r.sp_delta), 0)).toFixed(0)} SP removed ·
        {" "}{midSprint.length} mid-sprint
      </p>
      <table className="datatable">
        <tbody>
          {rows.slice(0, 8).map((r, i) => (
            <tr key={`${r.issue_key}-${i}`}>
              <td><JiraLink issueKey={r.issue_key} /></td>
              <td>{r.change_type === "added_mid_sprint" ? "added mid-sprint" : `${r.old_value ?? "·"} → ${r.new_value ?? "·"}`}</td>
              <td>
                {r.sp_delta != null ? (
                  <span className={`pill ${num(r.sp_delta) > 0 ? "bad" : "good"}`}>
                    {num(r.sp_delta) > 0 ? "+" : ""}
                    {fmtSp(r.sp_delta)}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BlockersPanel({ rows, loading }: { rows: BlockerRow[]; loading: boolean }) {
  return (
    <div className="panel">
      <h3>Blockers (open sub-tasks)</h3>
      {loading ? (
        <p className="muted small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No blockers in flight.</p>
      ) : (
        <table className="datatable">
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.issue_key}>
                <td><JiraLink issueKey={r.issue_key} /></td>
                <td>{r.summary.length > 36 ? r.summary.slice(0, 36) + "…" : r.summary}</td>
                <td>
                  <span className={`pill ${r.band === "red" ? "bad" : r.band === "yellow" ? "warn" : "good"}`}>
                    {r.age_days}d
                  </span>
                </td>
              </tr>
            ))}
            {rows.length > 8 && (
              <tr><td colSpan={3} className="muted small">… {rows.length - 8} more</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Tiny utility hook for ad-hoc fetches ----------------------------
// Keeps the scope-churn panel self-contained without expanding the main api/.

import { useEffect, useState } from "react";
function useStateAsync<T>(url: string): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => r.json())
      .then((d: T) => alive && setV(d))
      .catch(() => alive && setV([] as unknown as T));
    return () => {
      alive = false;
    };
  }, [url]);
  return v;
}
