/**
 * Phase 5.4 — Projects · Monitoring.
 *
 * Comparison table: each active project's velocity / churn / sprints-active
 * benchmarked against the median across closed snapshots in
 * project_snapshots. When fewer than 5 closed projects exist, the
 * comparison columns show a "not enough history yet" footnote per the
 * roadmap rule.
 */

import { useProjectComparison } from "../../api";
import type { ProjectComparison, ProjectListRow } from "../../api/types";
import InfoIcon from "../../components/InfoIcon";

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function deltaPct(value: number | null, baseline: number | null): number | null {
  if (value == null || baseline == null || baseline === 0) return null;
  return ((value - baseline) / baseline) * 100;
}

function deltaPp(value: number | null, baseline: number | null): number | null {
  if (value == null || baseline == null) return null;
  return value - baseline;
}

type Tone = "good" | "warn" | "bad" | "neutral";

function toneForVelocityDelta(d: number | null): Tone {
  if (d == null) return "neutral";
  if (d >= 10) return "good";
  if (d <= -20) return "bad";
  if (d <= -5) return "warn";
  return "neutral";
}

function toneForChurnDelta(d: number | null): Tone {
  if (d == null) return "neutral";
  if (d <= -2) return "good"; // less churn than median = good
  if (d >= 8) return "bad";
  if (d >= 3) return "warn";
  return "neutral";
}

export default function ProjectsMonitoringPage() {
  const { data, isLoading, error } = useProjectComparison();

  if (isLoading) return <div className="muted">Loading…</div>;
  if (error || !data)
    return <div className="muted">Failed to load comparison.</div>;

  return <ComparisonBody c={data} />;
}

function ComparisonBody({ c }: { c: ProjectComparison }) {
  const velMedian = num(c.velocity.median);
  const churnMedian = num(c.churn_pct.median);
  const enough = c.enough_history;

  return (
    <div>
      <h1>Projects · Monitoring</h1>
      <p className="muted">
        Active projects benchmarked against historical (closed) projects.
      </p>

      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3)",
          marginBottom: "var(--space-4)",
        }}
      >
        <table className="datatable">
          <thead>
            <tr>
              <th>Project</th>
              <th>
                Velocity
                <InfoIcon text="Average story points completed per sprint, computed across every sprint this project's issues have appeared in." />
              </th>
              <th>
                vs median
                <InfoIcon text="This project's velocity compared to the median velocity across all closed projects. +20% means 20% faster than the historical norm; −20% means slower." />
              </th>
              <th>
                Churn
                <InfoIcon text="Total scope change as a percentage of total SP — (SP added + SP removed) / total SP. Higher means the scope kept moving while the project was running." />
              </th>
              <th>
                vs median
                <InfoIcon text="Difference in churn percentage points (pp) vs. the median churn across closed projects. +5pp means 5 points more churn than typical." />
              </th>
              <th>
                Sprints
                <InfoIcon text="Distinct sprints any of this project's issues have been part of — open or closed. A rough proxy for project age." />
              </th>
            </tr>
          </thead>
          <tbody>
            {c.active.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted small">
                  No active projects.
                </td>
              </tr>
            ) : (
              c.active.map((p) => (
                <ComparisonRow
                  key={p.project_name}
                  p={p}
                  velMedian={velMedian}
                  churnMedian={churnMedian}
                  enough={enough}
                />
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={6}
                style={{
                  background: "var(--color-surface-2)",
                  padding: "var(--space-2)",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--color-text-muted)",
                }}
              >
                {c.completed_count === 0 ? (
                  <>
                    No closed projects yet — comparison columns will populate as
                    projects complete.
                  </>
                ) : enough ? (
                  <>
                    Baseline = median across <strong>{c.completed_count}</strong>{" "}
                    closed projects ({fmtStat(c.velocity.median)} SP/sprint
                    velocity, {fmtStat(c.churn_pct.median)}% churn).
                  </>
                ) : (
                  <>
                    Baseline = rough median across{" "}
                    <strong>{c.completed_count}</strong> closed project
                    {c.completed_count === 1 ? "" : "s"}. ⚠ Need ≥5 closed
                    snapshots for stable comparison.
                  </>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <CompletedStatsPanel c={c} />
    </div>
  );
}

function ComparisonRow({
  p,
  velMedian,
  churnMedian,
  enough,
}: {
  p: ProjectListRow;
  velMedian: number | null;
  churnMedian: number | null;
  enough: boolean;
}) {
  const vel = num(p.avg_velocity_sp);
  const churn = num(p.scope_churn_pct);
  const dVel = enough ? deltaPct(vel, velMedian) : null;
  const dChurn = enough ? deltaPp(churn, churnMedian) : null;
  const velTone = toneForVelocityDelta(dVel);
  const churnTone = toneForChurnDelta(dChurn);
  return (
    <tr>
      <td>
        <strong>{p.project_name}</strong>
      </td>
      <td>{vel != null ? `${vel.toFixed(1)} SP/sprint` : "—"}</td>
      <td>
        {dVel != null ? (
          <span className={`pill ${velTone}`}>
            {dVel >= 0 ? "+" : ""}
            {dVel.toFixed(0)}%
          </span>
        ) : (
          <span className="muted small">n/a</span>
        )}
      </td>
      <td>
        {churn != null ? `${churn.toFixed(0)}%` : "—"}
      </td>
      <td>
        {dChurn != null ? (
          <span className={`pill ${churnTone}`}>
            {dChurn >= 0 ? "+" : ""}
            {dChurn.toFixed(0)}pp
          </span>
        ) : (
          <span className="muted small">n/a</span>
        )}
      </td>
      <td>{p.sprints_active} active</td>
    </tr>
  );
}

function fmtStat(v: string | number | null): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

function CompletedStatsPanel({ c }: { c: ProjectComparison }) {
  if (c.completed_count === 0) return null;
  return (
    <>
      <h2>
        Closed-project distribution
        <InfoIcon text="Distribution stats across every closed project. p25 = 25th percentile (the slower / lower quarter), p75 = 75th. Used as the baseline for the comparison table above." />
      </h2>
      <div className="three-panel">
        <StatPanel
          title="Velocity (SP/sprint)"
          s={c.velocity}
          info="Average SP delivered per sprint, across each closed project's full duration."
        />
        <StatPanel
          title="Scope churn (%)"
          s={c.churn_pct}
          info="(SP added + SP removed) / total SP, expressed as a percentage."
        />
        <StatPanel
          title="Sprints active"
          s={c.sprints_active}
          info="Distinct sprints the project's issues appeared in, from first sprint to last."
        />
      </div>
    </>
  );
}

function StatPanel({
  title,
  s,
  info,
}: {
  title: string;
  s: ProjectComparison["velocity"];
  info?: string;
}) {
  return (
    <div className="panel">
      <h3>
        {title}
        {info && <InfoIcon text={info} />}
      </h3>
      <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <span className="muted small">p25</span>
        <strong>{fmtStat(s.p25)}</strong>
      </div>
      <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <span className="muted small">median</span>
        <strong>{fmtStat(s.median)}</strong>
      </div>
      <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <span className="muted small">p75</span>
        <strong>{fmtStat(s.p75)}</strong>
      </div>
      <div className="muted small">n={s.n}</div>
    </div>
  );
}
