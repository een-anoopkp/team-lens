/**
 * Phase 5.3 — Project drill-in.
 *
 * Layout:
 *   - 4 KPI tiles (Total SP, Done, Velocity, ETD-by-velocity)
 *   - ETD-by-sprint-assignment basis line (when available)
 *   - Epics table (each row a JiraLink + per-epic SP rollup)
 *   - Sprints touched (chip list, sorted by start_date)
 *   - Scope churn + contributors
 */

import { Link, useParams } from "react-router-dom";

import { useProject } from "../../api";
import type { ProjectDetail } from "../../api/types";
import InfoIcon from "../../components/InfoIcon";
import { JiraFilterLink, JiraLink } from "../../lib/jira";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtNum(v: string | number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

export default function ProjectDetailPage() {
  const { name = "" } = useParams<{ name: string }>();
  const { data, isLoading, error } = useProject(name);

  if (isLoading) return <div className="muted">Loading…</div>;
  if (error || !data) {
    return (
      <div>
        <p className="muted small">
          <Link to="/projects">← Projects</Link>
        </p>
        <h1>{name}</h1>
        <p className="muted">Not found.</p>
      </div>
    );
  }
  return <ProjectDetailBody p={data} />;
}

function ProjectDetailBody({ p }: { p: ProjectDetail }) {
  const pct = num(p.pct_done);
  const remaining = num(p.total_sp) - num(p.done_sp);
  const epicKeys = p.epics.map((e) => e.issue_key);

  return (
    <div>
      <p className="muted small">
        <Link to="/projects">← Projects</Link> ·{" "}
        <strong>{p.project_name}</strong>
      </p>
      <h1 style={{ marginTop: 0 }}>
        {p.project_name}{" "}
        {p.classification === "completed" ? (
          <span className="pill neutral">
            completed {fmtDate(p.completed_at)}
          </span>
        ) : (
          <span className="pill accent">active</span>
        )}
      </h1>

      <div className="kpi-row">
        <div className="kpi neutral">
          <div className="kpi-label">Total SP</div>
          <div className="kpi-value">{num(p.total_sp).toFixed(0)}</div>
          <div className="kpi-sub">
            across {p.epic_count} epic{p.epic_count === 1 ? "" : "s"}
          </div>
        </div>
        <div className="kpi good">
          <div className="kpi-label">Done</div>
          <div className="kpi-value">{num(p.done_sp).toFixed(0)}</div>
          <div className="kpi-sub">{pct.toFixed(0)}%</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">Velocity</div>
          <div className="kpi-value">{fmtNum(p.avg_velocity_sp)}</div>
          <div className="kpi-sub">
            SP/sprint over {p.sprints_active} sprint
            {p.sprints_active === 1 ? "" : "s"}
          </div>
        </div>
        <div className={`kpi ${p.classification === "completed" ? "neutral" : pct >= 60 ? "good" : pct >= 20 ? "warn" : "bad"}`}>
          <div className="kpi-label">ETD (by velocity)</div>
          <div className="kpi-value" style={{ fontSize: "1.2rem" }}>
            {p.classification === "completed" ? "—" : fmtDate(p.etd_by_velocity)}
          </div>
          <div className="kpi-sub">{p.etd_by_velocity_basis}</div>
        </div>
      </div>

      {p.classification === "active" && (
        <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
          <strong>ETD by sprint-assignment:</strong>{" "}
          {p.etd_by_sprint_assignment
            ? fmtDate(p.etd_by_sprint_assignment)
            : "—"}
          <div className="muted small">
            {p.etd_by_sprint_assignment_basis}
          </div>
          {remaining > 0 && (
            <div className="muted small" style={{ marginTop: 4 }}>
              {remaining.toFixed(0)} SP still open ·{" "}
              {p.avg_sprint_length_d != null
                ? `~${fmtNum(p.avg_sprint_length_d, 0)}d sprints`
                : ""}
            </div>
          )}
        </div>
      )}

      <h2>
        Epics <span className="pill neutral">{p.epics.length}</span>
        <JiraFilterLink keys={epicKeys} orderBy="status DESC" />
      </h2>
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
              <th>Epic</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Issues</th>
              <th>SP</th>
              <th>Done</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {p.epics.map((e) => {
              const epicPct =
                num(e.sp_total) > 0
                  ? (num(e.sp_done) / num(e.sp_total)) * 100
                  : 0;
              return (
                <tr key={e.issue_key}>
                  <td>
                    <JiraLink issueKey={e.issue_key} />
                  </td>
                  <td>
                    {e.summary.length > 60
                      ? e.summary.slice(0, 60) + "…"
                      : e.summary}
                  </td>
                  <td>{e.status}</td>
                  <td>{e.issue_count}</td>
                  <td>{num(e.sp_total).toFixed(0)}</td>
                  <td>{num(e.sp_done).toFixed(0)}</td>
                  <td>{epicPct.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>
        Sprints touched{" "}
        <span className="muted small">({p.sprints.length})</span>
      </h2>
      {p.sprints.length === 0 ? (
        <div className="muted small">
          No issues from this project are assigned to a sprint yet.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: "var(--space-4)",
          }}
        >
          {p.sprints.map((s) => (
            <span
              key={s.sprint_id}
              className={`pill ${s.state === "active" ? "accent" : "neutral"}`}
              title={
                s.start_date && s.end_date
                  ? `${s.start_date} → ${s.end_date}`
                  : ""
              }
            >
              {s.name}
            </span>
          ))}
        </div>
      )}

      <div className="three-panel">
        <div className="panel">
          <h3>
            Scope churn
            <InfoIcon text="(SP added + SP removed) / total SP. High churn means scope kept moving while the project was running — often a sign of unstable requirements or carry-over work being re-scoped." />
          </h3>
          <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
            <span className="muted small">SP added</span>
            <strong>+{num(p.sp_added_total).toFixed(0)}</strong>
          </div>
          <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
            <span className="muted small">SP removed</span>
            <strong>−{num(p.sp_removed_total).toFixed(0)}</strong>
          </div>
          <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
            <span className="muted small">Churn</span>
            <strong>
              {p.scope_churn_pct != null
                ? `${fmtNum(p.scope_churn_pct, 1)}%`
                : "—"}
            </strong>
          </div>
        </div>

        <div className="panel">
          <h3>Contributors ({p.contributors.length})</h3>
          {p.contributors.length === 0 ? (
            <div className="muted small">
              No assignees recorded on this project yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {p.contributors.map((c) => (
                <span key={c} className="pill neutral">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>

        {p.initiative_keys.length > 0 && (
          <div className="panel">
            <h3>Initiative parents</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {p.initiative_keys.map((k) => (
                <JiraLink key={k} issueKey={k} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
