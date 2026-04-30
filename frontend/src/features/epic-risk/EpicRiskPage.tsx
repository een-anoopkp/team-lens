/**
 * Epic Risk page — Phase 4.2.
 *
 * 4 hero KPIs (at-risk / watch / on-track / done counts) + risk-card grid
 * (sorted at-risk first by days_overdue) + epic throughput bar chart.
 *
 * Data: /api/v1/metrics/epic-risk + /api/v1/metrics/epic-throughput.
 */

import { useEpicRisk, useEpicThroughput } from "../../api";
import type { EpicRiskRow, ThroughputRow } from "../../api/types";
import { JiraLink } from "../../lib/jira";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

export default function EpicRiskPage() {
  const { data, isLoading } = useEpicRisk();
  const throughput = useEpicThroughput(6);

  if (isLoading) return <div className="muted">Loading…</div>;
  if (!data)
    return (
      <div>
        <h1>Epic Risk</h1>
        <p className="muted">No data yet.</p>
      </div>
    );

  const atRisk = data.epics.filter((e) => e.risk_band === "at_risk");
  const watch = data.epics.filter((e) => e.risk_band === "watch");

  return (
    <div>
      <h1>Epic Risk</h1>
      <p className="muted">
        Quarterly view of all team epics. At-risk first, sorted by days overdue.
      </p>

      <div className="kpi-row">
        <div className="kpi bad">
          <div className="kpi-label">At risk</div>
          <div className="kpi-value">{data.summary.at_risk}</div>
          <div className="kpi-sub">past due / no owner / inactive</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label">Watch</div>
          <div className="kpi-value">{data.summary.watch}</div>
          <div className="kpi-sub">slowing velocity</div>
        </div>
        <div className="kpi good">
          <div className="kpi-label">On track</div>
          <div className="kpi-value">{data.summary.on_track}</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">Done</div>
          <div className="kpi-value">{data.summary.done}</div>
        </div>
      </div>

      {atRisk.length > 0 && (
        <>
          <h2>At-risk epics <span className="pill bad">{atRisk.length}</span></h2>
          <div className="three-panel">
            {atRisk.slice(0, 12).map((e) => (
              <EpicRiskCard key={e.issue_key} epic={e} tone="bad" />
            ))}
          </div>
        </>
      )}

      {watch.length > 0 && (
        <>
          <h2>Watch <span className="pill warn">{watch.length}</span></h2>
          <div className="three-panel">
            {watch.slice(0, 9).map((e) => (
              <EpicRiskCard key={e.issue_key} epic={e} tone="warn" />
            ))}
          </div>
        </>
      )}

      {throughput.data && throughput.data.length > 0 && (
        <>
          <h2>Throughput <span className="muted small">(epics closed per sprint)</span></h2>
          <ThroughputChart data={throughput.data} />
        </>
      )}
    </div>
  );
}

function EpicRiskCard({ epic, tone }: { epic: EpicRiskRow; tone: "bad" | "warn" }) {
  const total = num(epic.sp_total);
  const done = num(epic.sp_done);
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div
      className="panel"
      style={{
        borderLeft: `4px solid var(--color-${tone === "bad" ? "bad" : "warn"})`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-1)",
        }}
      >
        <JiraLink issueKey={epic.issue_key} />
        <span className={`pill ${tone}`}>{epic.risk_band.replace("_", " ")}</span>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{epic.summary}</div>
      <div className="muted small" style={{ marginBottom: "var(--space-2)" }}>
        {epic.owner_display_name ?? <em>no owner</em>}
        {" · "}
        {epic.due_date ? `due ${epic.due_date}` : "no due date"}
        {epic.days_overdue != null && epic.days_overdue > 0 && (
          <> · <span style={{ color: "var(--color-bad-fg)" }}>{epic.days_overdue}d overdue</span></>
        )}
      </div>
      <div className="muted small" style={{ marginBottom: "var(--space-2)" }}>
        {done}/{total} SP done · {epic.issue_count} issues
        {epic.days_since_activity != null && (
          <> · last activity {epic.days_since_activity}d ago</>
        )}
      </div>
      <div className="progress-track">
        <span className="seg seg-done" style={{ width: `${pct}%` }} />
        <span className="seg seg-todo" style={{ width: `${100 - pct}%` }} />
      </div>
      {epic.risk_reasons.length > 0 && (
        <div style={{ marginTop: "var(--space-2)", display: "flex", flexWrap: "wrap", gap: 4 }}>
          {epic.risk_reasons.map((reason, i) => (
            <span key={i} className={`pill ${tone}`}>{reason}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ThroughputChart({ data }: { data: ThroughputRow[] }) {
  const w = 600;
  const h = 140;
  const margin = { left: 10, right: 10, top: 10, bottom: 30 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;
  const maxY = Math.max(...data.map((d) => d.closed_epics), 1);
  const barW = innerW / data.length - 8;
  return (
    <div className="chart-panel">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="chart">
        {data.map((d, i) => {
          const x = margin.left + i * (innerW / data.length) + 4;
          const barH = innerH * (d.closed_epics / maxY);
          const y = margin.top + (innerH - barH);
          return (
            <g key={d.sprint_id}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                fill="var(--color-accent)"
              />
              <text
                x={x + barW / 2}
                y={y - 4}
                fill="var(--color-text-muted)"
                fontSize="10"
                textAnchor="middle"
              >
                {d.closed_epics}
              </text>
              <text
                x={x + barW / 2}
                y={h - 8}
                fill="var(--color-text-muted)"
                fontSize="10"
                textAnchor="middle"
              >
                {d.sprint_name.replace("Search ", "")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
