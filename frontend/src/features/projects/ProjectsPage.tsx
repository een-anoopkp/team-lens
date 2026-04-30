/**
 * Phase 5.2 — Projects list.
 *
 * Active projects on top (cards with progress bar + ETD), then a collapsed
 * "Completed" section (read from project_snapshots).
 *
 * Health classification (active only):
 *   pct_done >= 60  → on track     (green bar, "good" pill)
 *   pct_done 20-59  → at risk      (warn bar, "warn" pill)
 *   pct_done < 20   → stalled      (bad bar, "bad" pill)
 *
 * (When a real velocity baseline lands via /comparison, we'll switch to
 * "behind median" / "ahead of median" — for now pct_done is the cheapest
 * actionable signal.)
 */

import { Link } from "react-router-dom";

import { useProjects } from "../../api";
import type { ProjectListRow } from "../../api/types";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

type Health = { tone: "good" | "warn" | "bad"; label: string };

function healthOf(p: ProjectListRow): Health {
  const pct = num(p.pct_done);
  if (pct >= 60) return { tone: "good", label: "on track" };
  if (pct >= 20) return { tone: "warn", label: "at risk" };
  return { tone: "bad", label: "stalled" };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ProjectsPage() {
  const { data, isLoading, error } = useProjects();

  if (isLoading) return <div className="muted">Loading…</div>;
  if (error)
    return (
      <div className="muted">Failed to load projects. Check backend logs.</div>
    );

  const rows = data ?? [];
  const active = rows.filter((r) => r.classification === "active");
  const completed = rows.filter((r) => r.classification === "completed");

  return (
    <div>
      <h1>Projects</h1>
      <p className="muted">
        Derived from epic labels prefixed <code>proj_</code>. Drill in for ETD.
        Tag epics in Jira to make them appear here.
      </p>

      <h2>Active {active.length > 0 && <span className="muted small">({active.length})</span>}</h2>
      {active.length === 0 ? (
        <div className="muted">
          No active projects yet. Add a <code>proj_*</code> label to one or more epics in Jira.
        </div>
      ) : (
        active.map((p) => <ActiveProjectCard key={p.project_name} p={p} />)
      )}

      <h2 style={{ marginTop: "var(--space-6)" }}>
        Completed{" "}
        <span className="muted small">({completed.length})</span>
      </h2>
      {completed.length === 0 ? (
        <div className="muted small">No completed projects yet.</div>
      ) : (
        <details>
          <summary className="muted" style={{ cursor: "pointer", padding: "var(--space-2) 0" }}>
            Show completed projects
          </summary>
          {completed.map((p) => (
            <CompletedProjectCard key={p.project_name} p={p} />
          ))}
        </details>
      )}
    </div>
  );
}

function ActiveProjectCard({ p }: { p: ProjectListRow }) {
  const pct = num(p.pct_done);
  const health = healthOf(p);
  return (
    <Link to={`/projects/${encodeURIComponent(p.project_name)}`} className="project-card">
      <div className="project-card-header">
        <span className="project-card-title">{p.project_name}</span>
        <span className={`pill ${health.tone}`}>{health.label}</span>
      </div>
      <div className="project-card-stats">
        <div className="project-card-stat">
          <strong>{p.epic_count} epics</strong>
        </div>
        <div className="project-card-stat">
          <strong>
            {num(p.done_sp)} / {num(p.total_sp)} SP
          </strong>{" "}
          done ({pct.toFixed(0)}%)
        </div>
        <div className="project-card-stat">
          Velocity{" "}
          <strong>
            {p.avg_velocity_sp != null
              ? `${num(p.avg_velocity_sp).toFixed(1)} SP/sprint`
              : "—"}
          </strong>
        </div>
        <div className="project-card-stat">
          ETD <strong>{fmtDate(p.etd_by_velocity)}</strong>
          {p.etd_by_sprint_assignment && (
            <div className="muted small">
              by sprint-asg: {fmtDate(p.etd_by_sprint_assignment)}
            </div>
          )}
        </div>
      </div>
      <div className={`project-bar ${health.tone === "good" ? "" : health.tone}`}>
        <div style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
    </Link>
  );
}

function CompletedProjectCard({ p }: { p: ProjectListRow }) {
  return (
    <Link
      to={`/projects/${encodeURIComponent(p.project_name)}`}
      className="project-card"
      style={{ opacity: 0.85 }}
    >
      <div className="project-card-header">
        <span className="project-card-title">{p.project_name}</span>
        <span className="pill neutral">
          completed {fmtDate(p.completed_at)}
        </span>
      </div>
      <div className="project-card-stats">
        <div className="project-card-stat">
          <strong>
            {p.epic_count} epics · {num(p.total_sp)} SP
          </strong>
        </div>
        <div className="project-card-stat">
          Velocity{" "}
          {p.avg_velocity_sp != null
            ? `${num(p.avg_velocity_sp).toFixed(1)} SP/sprint`
            : "—"}
        </div>
        <div className="project-card-stat">
          {p.sprints_active} sprints active
        </div>
      </div>
    </Link>
  );
}
