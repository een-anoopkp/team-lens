/**
 * /insights/rules — config + production surface (v3).
 *
 * Toggle each rule on/off, "Run all enabled" for LLM rules, "Run for…"
 * to run an LLM rule with a non-default scope, see recent run history,
 * inspect API key + 30-day spend.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  useInsightHistory,
  useInsightRules,
  useInsightSpend,
  useProjects,
  useRunAllEnabled,
  useRunInsightRule,
  useRunInsightRuleFor,
  useSettings,
  useSprints,
  useToggleInsightRule,
} from "../../api";
import type { InsightRuleRow } from "../../api/types";
import InfoIcon from "../../components/InfoIcon";

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

export default function InsightsRulesPage() {
  const rules = useInsightRules();
  if (rules.isLoading) return <div className="muted">Loading…</div>;
  if (!rules.data) return <div className="muted">Failed to load.</div>;

  const anomalies = rules.data.rules.filter((r) => r.kind === "anomaly");
  const llms = rules.data.rules.filter((r) => r.kind === "llm");

  return (
    <div>
      <p className="muted small">
        <Link to="/insights">← Insights</Link> · <strong>Rules</strong>
      </p>
      <h1 style={{ marginTop: 0 }}>Insights · Rules</h1>
      <p className="muted">
        Nine baked-in rules. Toggle on/off, run on demand, or
        "Run for…" against a non-default scope.
      </p>

      <AnomalyTable rules={anomalies} />
      <LLMTable rules={llms} />
      <APIKeyPanel />
      <RunHistory />
    </div>
  );
}

// ---- Anomaly table ---------------------------------------------------------

function AnomalyTable({ rules }: { rules: InsightRuleRow[] }) {
  const toggle = useToggleInsightRule();
  return (
    <>
      <h2>
        Anomaly rules <span className="muted small">(SQL · auto after sync)</span>
      </h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Anomaly rules are cheap (SQL only). They auto-run after every sync.
        Toggling off hides a rule from <code>/insights</code> without
        deleting its history.
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
              <th style={{ width: 60 }}>On</th>
              <th>Rule</th>
              <th>Last fired</th>
              <th>Last firings</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>
                  <ToggleCheckbox
                    checked={r.enabled}
                    onChange={(v) =>
                      toggle.mutate({ id: r.id, enabled: v })
                    }
                  />
                </td>
                <td>
                  <strong>{r.title}</strong>
                  <br />
                  <span className="muted small">{r.description}</span>
                </td>
                <td className="muted small">
                  {fmtRelative(r.last_run_at)}
                </td>
                <td>{r.last_firings_count ?? "—"}</td>
                <td>
                  {r.last_run_status ? (
                    <span
                      className={`pill ${r.last_run_status === "ok" ? "good" : "bad"}`}
                    >
                      {r.last_run_status}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- LLM table -------------------------------------------------------------

function LLMTable({ rules }: { rules: InsightRuleRow[] }) {
  const toggle = useToggleInsightRule();
  const run = useRunInsightRule();
  const runAll = useRunAllEnabled();
  const [runFor, setRunFor] = useState<InsightRuleRow | null>(null);

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginTop: "var(--space-5)",
        }}
      >
        <h2 style={{ margin: 0 }}>
          LLM rules{" "}
          <span className="muted small">(Claude · auto-refresh stale)</span>
        </h2>
        <button
          type="button"
          onClick={() => runAll.mutate()}
          disabled={enabledCount === 0 || runAll.isPending}
          style={primaryButtonStyle(enabledCount > 0)}
          title="Re-runs all rules toggled on, regardless of staleness"
        >
          {runAll.isPending
            ? "Queued…"
            : `Run all enabled (${enabledCount})`}
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 4 }}>
        Toggle a rule to enable: enabled rules auto-run when stale, and
        are picked up by <em>Run all enabled</em>. Disabled rules render
        frozen on <code>/insights</code>. Use <em>Run for…</em> to run
        against a non-default scope (e.g. a different sprint or project).
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
              <th style={{ width: 60 }}>On</th>
              <th>Rule</th>
              <th>Default scope</th>
              <th>Last run</th>
              <th>Tokens (last)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const scopeKw =
                (r.config as { scope?: string }).scope ?? "team_wide";
              const scopeLabel =
                scopeKw === "most_recent_closed_sprint"
                  ? "most-recent closed sprint"
                  : scopeKw === "team_wide"
                    ? "—"
                    : scopeKw;
              const supportsRunFor = scopeKw === "most_recent_closed_sprint";
              return (
                <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                  <td>
                    <ToggleCheckbox
                      checked={r.enabled}
                      onChange={(v) =>
                        toggle.mutate({ id: r.id, enabled: v })
                      }
                    />
                  </td>
                  <td>
                    <strong>{r.title}</strong>
                    <br />
                    <span className="muted small">
                      v{r.prompt_version ?? "?"} · {r.description}
                    </span>
                  </td>
                  <td className="muted small">{scopeLabel}</td>
                  <td className="muted small">
                    {fmtRelative(r.last_run_at)}
                  </td>
                  <td className="muted small">
                    {r.last_tokens != null
                      ? `${r.last_tokens.toLocaleString()}`
                      : "—"}
                  </td>
                  <td>
                    {supportsRunFor ? (
                      <button
                        type="button"
                        disabled={!r.enabled}
                        onClick={() => setRunFor(r)}
                        style={smallSecondaryStyle(r.enabled)}
                      >
                        Run for…
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!r.enabled || run.isPending}
                        onClick={() => run.mutate(r.id)}
                        style={smallSecondaryStyle(r.enabled)}
                      >
                        Run
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {runFor && (
        <RunForModal rule={runFor} onClose={() => setRunFor(null)} />
      )}
    </>
  );
}

// ---- "Run for…" modal ------------------------------------------------------

function RunForModal({
  rule,
  onClose,
}: {
  rule: InsightRuleRow;
  onClose: () => void;
}) {
  const sprints = useSprints("all");
  const projects = useProjects();
  const runFor = useRunInsightRuleFor();

  const sortedSprints = useMemo(() => {
    return (sprints.data ?? [])
      .slice()
      .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
  }, [sprints.data]);

  const wantsSprint =
    rule.id === "retro-agenda" ||
    rule.id === "stakeholder-update" ||
    rule.id === "project-summary";
  const wantsProject = false; // none of the v3 rules currently take a project
  const [sprintId, setSprintId] = useState<number | "">("");
  const [projectName, setProjectName] = useState("");

  const canSubmit =
    (!wantsSprint || sprintId !== "") && (!wantsProject || !!projectName);

  const submit = () => {
    const scope: Record<string, unknown> = {};
    if (wantsSprint && sprintId !== "") scope.sprint_id = Number(sprintId);
    if (wantsProject && projectName) scope.project = projectName;
    runFor.mutate(
      { id: rule.id, scope },
      { onSuccess: () => onClose() }
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)",
          padding: "var(--space-4)",
          borderRadius: "var(--radius-md)",
          minWidth: 360,
          maxWidth: 480,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Run {rule.title} for…</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Result lands on <code>/insights</code>, replacing the current
          default-scope output until the default re-runs.
        </p>

        {wantsSprint && (
          <label
            style={{
              display: "block",
              marginBottom: "var(--space-3)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <span className="muted small">Sprint</span>
            <br />
            <select
              value={sprintId}
              onChange={(e) =>
                setSprintId(e.target.value ? Number(e.target.value) : "")
              }
              style={inputStyle}
            >
              <option value="">— pick a sprint —</option>
              {sortedSprints.map((s) => (
                <option key={s.sprint_id} value={s.sprint_id}>
                  {s.name} ({s.state})
                </option>
              ))}
            </select>
          </label>
        )}
        {wantsProject && (
          <label
            style={{
              display: "block",
              marginBottom: "var(--space-3)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <span className="muted small">Project</span>
            <br />
            <select
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              style={inputStyle}
            >
              <option value="">— pick a project —</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.project_name} value={p.project_name}>
                  {p.project_name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={smallSecondaryStyle(true)}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || runFor.isPending}
            style={primaryButtonStyle(canSubmit)}
          >
            {runFor.isPending ? "Queueing…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- API key panel ---------------------------------------------------------

function APIKeyPanel() {
  const settings = useSettings();
  const spend = useInsightSpend(30);
  // Heuristic: if there's any spend in 30d, the key worked at least once.
  const hasRunsWithTokens = (spend.data?.tokens_in ?? 0) > 0;

  return (
    <>
      <h2 style={{ marginTop: "var(--space-5)" }}>
        Anthropic API key{" "}
        <InfoIcon text="Required for the LLM rules. Stored in backend/.env as ANTHROPIC_API_KEY. Never returned by any endpoint — only the last 4 chars are shown." />
      </h2>
      <div className="panel">
        <div
          className="proto-row"
          style={{ gridTemplateColumns: "200px 1fr auto" }}
        >
          <span className="muted small">Status</span>
          <span>
            {/* If we don't track the key on /settings, infer from spend. */}
            {hasRunsWithTokens ? (
              <span className="pill good">working</span>
            ) : settings.data ? (
              <span className="pill warn">not yet used</span>
            ) : (
              <span className="muted small">…</span>
            )}
          </span>
          <span></span>
        </div>
        <div
          className="proto-row"
          style={{ gridTemplateColumns: "200px 1fr auto" }}
        >
          <span className="muted small">Configure</span>
          <span className="muted small">
            Edit <code>backend/.env</code> → <code>ANTHROPIC_API_KEY=…</code>{" "}
            and restart the backend. (Or set <code>ANTHROPIC_MODEL</code>{" "}
            to override the default — currently{" "}
            <code>claude-sonnet-4-6</code>.)
          </span>
          <span></span>
        </div>
        <div
          className="proto-row"
          style={{ gridTemplateColumns: "200px 1fr auto" }}
        >
          <span className="muted small">Spend (last 30 d)</span>
          <span>
            {spend.data
              ? `${spend.data.total_runs} runs · ${spend.data.tokens_in.toLocaleString()} in / ${spend.data.tokens_out.toLocaleString()} out tokens`
              : "—"}
          </span>
          <span></span>
        </div>
      </div>
    </>
  );
}

// ---- Run history -----------------------------------------------------------

function RunHistory() {
  const history = useInsightHistory(20);
  return (
    <>
      <h2 style={{ marginTop: "var(--space-5)" }}>
        Run history <span className="muted small">(last 20)</span>
      </h2>
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3)",
        }}
      >
        <table className="datatable">
          <thead>
            <tr>
              <th>When</th>
              <th>Rule</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {(history.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="muted small">{fmtRelative(r.started_at)}</td>
                <td>
                  <strong>{r.rule_id}</strong>
                  {r.scope && (
                    <span className="muted small">
                      {" "}
                      · {Object.entries(r.scope)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </span>
                  )}
                </td>
                <td className="muted small">{r.trigger}</td>
                <td>
                  <span
                    className={`pill ${
                      r.status === "ok"
                        ? "good"
                        : r.status === "running"
                          ? "warn"
                          : "bad"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="muted small">
                  {r.firings_count != null
                    ? `${r.firings_count} firings`
                    : r.tokens_in != null
                      ? `${r.tokens_in} → ${r.tokens_out} tokens`
                      : r.error_message
                        ? r.error_message.slice(0, 80)
                        : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- Shared UI bits --------------------------------------------------------

function ToggleCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-block",
        position: "relative",
        width: 32,
        height: 18,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ opacity: 0, position: "absolute", pointerEvents: "none" }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          background: checked
            ? "var(--color-accent)"
            : "var(--color-border-strong)",
          borderRadius: 999,
          transition: "background 120ms ease",
        }}
      />
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transform: checked ? "translateX(14px)" : undefined,
          transition: "transform 120ms ease",
        }}
      />
    </label>
  );
}

function primaryButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-accent)",
    background: enabled ? "var(--color-accent)" : "var(--color-surface-2)",
    color: enabled ? "#fff" : "var(--color-text-muted)",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.6,
    fontSize: "var(--font-size-sm)",
    fontWeight: 500,
  };
}

function smallSecondaryStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)",
    color: enabled ? "var(--color-text)" : "var(--color-text-muted)",
    cursor: enabled ? "pointer" : "not-allowed",
    fontSize: "var(--font-size-xs)",
  };
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: "var(--font-size-sm)",
  fontFamily: "inherit",
  width: "100%",
};
