/**
 * Leaderboard — Jira-side metrics live; GitHub-side stays as v3 mock tiles.
 *
 * Three scope dimensions chosen via segmented buttons:
 *   - Sprint   → strict-completed within sprint.start..complete window
 *   - Quarter  → resolution_date within calendar quarter
 *   - Project  → every done issue under any proj_<name> epic, no date filter
 *
 * For each, a per-person table (sorted by SP delivered, with rank, ticket
 * count, and avg SP/ticket). Below: 4 stub tiles for GitHub metrics (PRs
 * opened, PRs reviewed, review turnaround, peer kudos) that are part of v3.
 */

import { useEffect, useMemo, useState } from "react";

import {
  useLeaderboard,
  useLeaderboardQuarters,
  useProjects,
  useSprints,
} from "../../api";
import type { LeaderboardScope } from "../../api";
import type { LeaderRow } from "../../api/types";
import InfoIcon from "../../components/InfoIcon";

type Tab = "sprint" | "quarter" | "project";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>("sprint");

  return (
    <div>
      <h1>Leaderboard</h1>
      <p className="muted">
        Per-person Jira contributions in a chosen window. GitHub-side
        metrics (PRs, reviews, kudos) land in v3 once a GitHub PAT is
        wired up — placeholder tiles below.
      </p>

      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          background: "var(--color-surface-2)",
          borderRadius: "var(--radius-md)",
          marginBottom: "var(--space-3)",
        }}
      >
        {(["sprint", "quarter", "project"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: "6px 14px",
              border: "none",
              borderRadius: "var(--radius-md)",
              background:
                tab === t ? "var(--color-surface)" : "transparent",
              color:
                tab === t ? "var(--color-accent)" : "var(--color-text-muted)",
              fontWeight: tab === t ? 600 : 400,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "sprint" && <SprintTab />}
      {tab === "quarter" && <QuarterTab />}
      {tab === "project" && <ProjectTab />}

      <GitHubStubTiles />
    </div>
  );
}

// ---- Tabs ------------------------------------------------------------------

function SprintTab() {
  const sprints = useSprints("all");
  // Default: most recent sprint with start_date set.
  const sortedSprints = useMemo(() => {
    return (sprints.data ?? [])
      .filter((s) => s.start_date)
      .sort((a, b) =>
        (b.start_date ?? "").localeCompare(a.start_date ?? "")
      );
  }, [sprints.data]);
  const [sprintId, setSprintId] = useState<number | null>(null);
  useEffect(() => {
    if (sprintId == null && sortedSprints.length > 0) {
      setSprintId(sortedSprints[0].sprint_id);
    }
  }, [sortedSprints, sprintId]);

  const scope: LeaderboardScope | null =
    sprintId != null ? { scope: "sprint", sprint_id: sprintId } : null;

  return (
    <>
      <ScopePicker label="Sprint">
        <select
          value={sprintId ?? ""}
          onChange={(e) => setSprintId(Number(e.target.value))}
          style={selectStyle}
        >
          {sortedSprints.map((s) => (
            <option key={s.sprint_id} value={s.sprint_id}>
              {s.name} ({s.state})
            </option>
          ))}
        </select>
      </ScopePicker>
      <LeaderTable scope={scope} />
    </>
  );
}

function QuarterTab() {
  const quarters = useLeaderboardQuarters();
  const [quarter, setQuarter] = useState<string | null>(null);
  useEffect(() => {
    const list = quarters.data?.quarters ?? [];
    if (quarter == null && list.length > 0) setQuarter(list[0]);
  }, [quarters.data, quarter]);

  const scope: LeaderboardScope | null =
    quarter ? { scope: "quarter", quarter } : null;

  return (
    <>
      <ScopePicker label="Quarter">
        <select
          value={quarter ?? ""}
          onChange={(e) => setQuarter(e.target.value)}
          style={selectStyle}
        >
          {(quarters.data?.quarters ?? []).map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </ScopePicker>
      <LeaderTable scope={scope} />
    </>
  );
}

function ProjectTab() {
  const projects = useProjects();
  const [project, setProject] = useState<string | null>(null);
  useEffect(() => {
    const list = projects.data ?? [];
    if (project == null && list.length > 0) setProject(list[0].project_name);
  }, [projects.data, project]);

  const scope: LeaderboardScope | null =
    project ? { scope: "project", project } : null;

  return (
    <>
      <ScopePicker label="Project">
        <select
          value={project ?? ""}
          onChange={(e) => setProject(e.target.value)}
          style={selectStyle}
        >
          {(projects.data ?? []).map((p) => (
            <option key={p.project_name} value={p.project_name}>
              {p.project_name} ({p.classification})
            </option>
          ))}
        </select>
      </ScopePicker>
      <LeaderTable scope={scope} />
    </>
  );
}

// ---- Shared bits -----------------------------------------------------------

function ScopePicker({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        marginBottom: "var(--space-3)",
      }}
    >
      <span className="muted small">{label}:</span>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: "var(--font-size-sm)",
  fontFamily: "inherit",
  minWidth: 220,
};

function LeaderTable({ scope }: { scope: LeaderboardScope | null }) {
  const lb = useLeaderboard(scope);

  if (!scope) return <div className="muted small">Pick a scope above.</div>;
  if (lb.isLoading) return <div className="muted">Loading…</div>;
  if (lb.error || !lb.data)
    return <div className="muted">Failed to load leaderboard.</div>;

  const d = lb.data;
  const maxSp = Math.max(1, ...d.rows.map((r) => num(r.sp_delivered)));

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          marginBottom: "var(--space-3)",
        }}
      >
        <Stat label="Scope" value={d.scope_label} />
        {d.window_start && d.window_end && (
          <Stat label="Window" value={`${d.window_start} → ${d.window_end}`} />
        )}
        <Stat label="Tickets closed" value={String(d.total_tickets)} />
        <Stat label="SP delivered" value={`${num(d.total_sp).toFixed(0)}`} />
        <Stat label="People" value={String(d.rows.length)} />
      </div>

      {d.rows.length === 0 ? (
        <div className="muted small">No closed tickets in this scope.</div>
      ) : (
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
                <th style={{ width: 40 }}>#</th>
                <th>Person</th>
                <th>
                  Tickets{" "}
                  <InfoIcon text="Distinct issues with status_category=done that fall inside the chosen scope. Sub-tasks are counted (they're real work) but contribute 0 to SP delivered." />
                </th>
                <th>
                  SP delivered{" "}
                  <InfoIcon text="Sum of story_points for non-Sub-task issues completed in this window. Sub-tasks have no SP on this tenant." />
                </th>
                <th>
                  Avg SP/ticket{" "}
                  <InfoIcon text="SP delivered divided by tickets closed. A high count + low avg often means many small sub-tasks; high count + high avg means real story throughput." />
                </th>
                <th>Distribution</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <LeaderRowView
                  key={r.person_account_id}
                  rank={i + 1}
                  row={r}
                  maxSp={maxSp}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function LeaderRowView({
  rank,
  row,
  maxSp,
}: {
  rank: number;
  row: LeaderRow;
  maxSp: number;
}) {
  const sp = num(row.sp_delivered);
  const pct = maxSp > 0 ? (sp / maxSp) * 100 : 0;
  return (
    <tr>
      <td>
        <span
          className={`pill ${rank === 1 ? "good" : rank <= 3 ? "accent" : "neutral"}`}
        >
          {rank}
        </span>
      </td>
      <td>
        {row.person_display_name ?? (
          <span className="muted">{row.person_account_id}</span>
        )}
      </td>
      <td>{row.tickets_closed}</td>
      <td>{sp.toFixed(0)}</td>
      <td>
        {row.avg_sp_per_ticket != null
          ? num(row.avg_sp_per_ticket).toFixed(1)
          : "—"}
      </td>
      <td style={{ minWidth: 160 }}>
        <div
          style={{
            height: 8,
            background: "var(--color-neutral-bg)",
            borderRadius: "var(--radius-pill)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--color-accent)",
              transition: "width 200ms ease",
            }}
          />
        </div>
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        fontSize: "var(--font-size-sm)",
      }}
    >
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// ---- GitHub stubs ----------------------------------------------------------

function GitHubStubTiles() {
  const stubs = [
    { label: "PRs opened", help: "From GitHub via PAT — count of PRs you authored in window." },
    { label: "PRs reviewed", help: "Review approvals + change-requests + comments left on others' PRs." },
    {
      label: "Median review turnaround",
      help: "Time from PR open → first review by you. Lower is better.",
    },
    { label: "Peer kudos", help: "Reactions / shoutouts captured locally — out-of-scope for now." },
  ];
  return (
    <>
      <h2 style={{ marginTop: "var(--space-5)" }}>
        GitHub contributions{" "}
        <span
          style={{
            fontSize: 12,
            verticalAlign: "middle",
            color: "var(--color-text-muted)",
            background: "rgba(0,0,0,0.05)",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          v3
        </span>
      </h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Empty placeholders. Wire-up plan:{" "}
        <code>docs/local-app/10-roadmap-v3.md → v3-B</code>. Needs a GitHub
        PAT in <code>.env</code> and a new sync pipeline.
      </p>
      <div className="kpi-row">
        {stubs.map((s) => (
          <div
            key={s.label}
            className="kpi neutral"
            style={{ opacity: 0.6 }}
            title={s.help}
          >
            <div className="kpi-label">{s.label}</div>
            <div className="kpi-value" style={{ color: "var(--color-text-muted)" }}>
              —
            </div>
            <div className="kpi-sub">v3 · needs GitHub PAT</div>
          </div>
        ))}
      </div>
    </>
  );
}
