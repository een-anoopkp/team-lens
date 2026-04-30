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
import { JiraFilterLink, JiraLink } from "../../lib/jira";

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
  const onTrack = data.epics.filter((e) => e.risk_band === "on_track");
  const done = data.epics.filter((e) => e.risk_band === "done");
  // Mirror the backend's no_project rule: open + has a due date + no
  // proj_* label. Undated epics are unscheduled future work.
  const noProject = data.epics.filter(
    (e) => !e.has_project && e.risk_band !== "done" && e.due_date != null
  );

  return (
    <div>
      <h1>Epic Risk</h1>
      <p className="muted">
        Quarterly view of all team epics. At-risk first, sorted by days overdue.
      </p>

      <div className="kpi-row">
        <div className="kpi bad">
          <div className="kpi-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>At risk</span>
            <JiraFilterLink keys={atRisk.map((e) => e.issue_key)} orderBy="duedate ASC" />
          </div>
          <div className="kpi-value">{data.summary.at_risk}</div>
          <div className="kpi-sub">past due / no owner / inactive</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Watch</span>
            <JiraFilterLink keys={watch.map((e) => e.issue_key)} orderBy="duedate ASC" />
          </div>
          <div className="kpi-value">{data.summary.watch}</div>
          <div className="kpi-sub">slowing velocity</div>
        </div>
        <div className="kpi good">
          <div className="kpi-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>On track</span>
            <JiraFilterLink keys={onTrack.map((e) => e.issue_key)} orderBy="duedate ASC" />
          </div>
          <div className="kpi-value">{data.summary.on_track}</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Done</span>
            <JiraFilterLink keys={done.map((e) => e.issue_key)} orderBy="resolutiondate DESC" />
          </div>
          <div className="kpi-value">{data.summary.done}</div>
        </div>
        <div className={`kpi ${data.summary.no_project > 0 ? "warn" : "neutral"}`}>
          <div className="kpi-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>No project</span>
            <JiraFilterLink keys={noProject.map((e) => e.issue_key)} orderBy="duedate ASC" />
          </div>
          <div className="kpi-value">{data.summary.no_project}</div>
          <div className="kpi-sub" title="Open epics with no proj_* label. Add a label in Jira to make them appear on /projects.">
            no proj_* label
          </div>
        </div>
      </div>

      {atRisk.length > 0 && (
        <>
          <h2>
            At-risk epics <span className="pill bad">{atRisk.length}</span>
            <JiraFilterLink keys={atRisk.map((e) => e.issue_key)} orderBy="duedate ASC" />
          </h2>
          <RiskRulesPanel />
          <div className="three-panel">
            {atRisk.slice(0, 12).map((e) => (
              <EpicRiskCard key={e.issue_key} epic={e} tone="bad" />
            ))}
          </div>
        </>
      )}

      {watch.length > 0 && (
        <>
          <h2>
            Watch <span className="pill warn">{watch.length}</span>
            <JiraFilterLink keys={watch.map((e) => e.issue_key)} orderBy="duedate ASC" />
          </h2>
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

/**
 * Always-visible (default-collapsed) summary of the rules behind every
 * "at_risk" / "watch" classification. Surfaced here so the filter logic
 * doesn't get lost as more rules accumulate over time.
 */
function RiskRulesPanel() {
  return (
    <details
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-2) var(--space-3)",
        marginBottom: "var(--space-3)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          color: "var(--color-text-muted)",
          userSelect: "none",
        }}
      >
        How is risk computed? (rules + filters applied)
      </summary>
      <div style={{ paddingTop: "var(--space-2)", lineHeight: 1.6 }}>
        <strong>Scope filter</strong>
        <ul style={{ margin: "4px 0 var(--space-2) var(--space-3)" }}>
          <li>
            Only epics where the team field <code>customfield_10500</code>{" "}
            equals the configured Search-team UUID. Foreign-team parent
            epics that we pulled in only as hierarchy context for our
            issues are excluded.
          </li>
        </ul>

        <strong>
          <span className="pill bad">at_risk</span> — any one triggers
        </strong>
        <ul style={{ margin: "4px 0 var(--space-2) var(--space-3)" }}>
          <li>
            <code>past due</code> — <code>due_date &lt; today</code> AND
            not done.
          </li>
          <li>
            <code>no owner</code> — <code>owner_account_id IS NULL</code>.
          </li>
          <li>
            <code>no activity Nd</code> — most recent child-issue update
            &gt; 14 days ago, <em>only when a due_date is set</em>{" "}
            (undated epics have no planning anchor, so we don't flag them
            for inactivity).
          </li>
        </ul>

        <strong>
          <span className="pill warn">watch</span> — any one triggers
          (and no at_risk reason fires)
        </strong>
        <ul style={{ margin: "4px 0 var(--space-2) var(--space-3)" }}>
          <li>
            <code>slow progress</code> — &lt; 30% SP done AND no activity
            for &gt; 7 days.
          </li>
          <li>
            <code>due soon, behind</code> — due in ≤ 14 days AND &lt; 70%
            SP done.
          </li>
        </ul>

        <strong>
          <span className="pill good">on_track</span>
        </strong>{" "}
        — in progress with no triggers above.{" "}
        <strong>
          <span className="pill neutral">done</span>
        </strong>{" "}
        — <code>status_category = done</code>.
      </div>
    </details>
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
  // Larger viewBox so 12-14px text inside the SVG renders close to its
  // native CSS pixel size when the chart is laid out at typical widths
  // (~800px on most screens). Smaller viewBoxes were forcing ~2× upscale
  // which looked soft / pixelated on the bar labels.
  const w = 1200;
  const h = 240;
  const margin = { left: 44, right: 16, top: 16, bottom: 36 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;
  const maxY = Math.max(...data.map((d) => d.closed_epics), 1);
  const slotW = data.length > 0 ? innerW / data.length : innerW;
  const barW = Math.max(slotW * 0.6, 4);

  // Y-axis ticks at 0, mid, max. Integer labels (epic counts).
  const yTicks = Array.from(
    new Set([0, Math.round(maxY / 2), maxY]),
  ).sort((a, b) => a - b);

  return (
    <div className="chart-panel">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart">
        {/* Y-axis gridlines + labels */}
        <g className="chart-axis">
          {yTicks.map((tick) => {
            const y = margin.top + innerH * (1 - tick / maxY);
            return (
              <g key={tick}>
                <line
                  x1={margin.left}
                  y1={y}
                  x2={w - margin.right}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={tick === 0 ? 1 : 0.5}
                  strokeDasharray={tick === 0 ? undefined : "4 6"}
                />
                <text
                  x={margin.left - 8}
                  y={y + 5}
                  textAnchor="end"
                  fontSize="14"
                >
                  {tick}
                </text>
              </g>
            );
          })}
        </g>
        {/* Bars + labels */}
        {data.map((d, i) => {
          const slotX = margin.left + i * slotW;
          const x = slotX + (slotW - barW) / 2;
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
                x={slotX + slotW / 2}
                y={y - 6}
                fill="var(--color-text-muted)"
                fontSize="14"
                textAnchor="middle"
              >
                {d.closed_epics}
              </text>
              <text
                x={slotX + slotW / 2}
                y={h - 12}
                fill="var(--color-text-muted)"
                fontSize="13"
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
