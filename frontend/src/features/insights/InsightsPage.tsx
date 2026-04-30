/**
 * /insights — read surface (v3).
 *
 * Anomalies (auto-run after every sync) on top, LLM summaries below.
 * No buttons or scope pickers — every output is "right now". Stale LLM
 * outputs trigger a background re-run on visit; the page polls every
 * 5 s while any rule is running.
 *
 * To toggle rules on/off, change defaults, or run for a non-default
 * scope, the user goes to /insights/rules.
 */

import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";

import { useInsightsFeed } from "../../api";
import type { AnomalyCard, LLMCard, LLMCardState } from "../../api/types";
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

export default function InsightsPage() {
  const { data, isLoading, error } = useInsightsFeed();

  if (isLoading) return <div className="muted">Loading…</div>;
  if (error || !data) {
    return (
      <div>
        <h1>Insights</h1>
        <p className="muted">Failed to load. Check backend logs.</p>
      </div>
    );
  }

  const enabledAnomalies = data.anomalies.filter((a) => a.enabled);
  const totalFirings = enabledAnomalies.reduce(
    (n, a) => n + a.firings.length,
    0
  );

  return (
    <div>
      <h1>Insights</h1>
      <p className="muted">
        Anomalies update automatically after each sync. Summaries are
        auto-refreshed when stale — manage rules under{" "}
        <Link to="/insights/rules">Insights · Rules</Link>.
      </p>

      <div
        className="sprint-banner sprint-banner-active"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <strong>Anomalies</strong>
          <span className="muted small" style={{ marginLeft: "var(--space-2)" }}>
            {enabledAnomalies.length} rules · {totalFirings} firings · last
            evaluated {fmtRelative(data.last_anomaly_eval_at)}
          </span>
        </div>
        {data.queued_runs.length > 0 && (
          <span className="pill warn">
            regenerating {data.queued_runs.length} summary
            {data.queued_runs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="three-panel" style={{ marginBottom: "var(--space-5)" }}>
        {data.anomalies.map((a) => (
          <AnomalyTile key={a.rule_id} card={a} />
        ))}
      </div>

      <h2>
        Summaries{" "}
        <InfoIcon text="LLM-generated narratives over the team's local DB. Each rule auto-runs when its cached output goes stale (per-rule threshold). Toggle off in Rules to suppress." />
      </h2>
      <div className="three-panel">
        {data.summaries.map((s) => (
          <SummaryTile key={s.rule_id} card={s} />
        ))}
      </div>

      <p className="muted small" style={{ marginTop: "var(--space-4)" }}>
        Stale thresholds are baked in per rule. Anomaly + summary history
        is retained for 90 days.
      </p>
    </div>
  );
}

// ---- Anomaly tile ----------------------------------------------------------

function AnomalyTile({ card }: { card: AnomalyCard }) {
  const tone = anomalyTone(card);
  const hasFirings = card.firings.length > 0;

  return (
    <div
      className="panel"
      style={{
        borderLeft: `4px solid var(--color-${tone === "good" ? "good" : tone === "warn" ? "warn" : tone === "bad" ? "bad" : "border"})`,
        opacity: card.enabled ? 1 : 0.5,
      }}
    >
      <h3
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>
          {card.title}{" "}
          <span className={`pill ${tone}`}>{card.firings.length}</span>
        </span>
        {card.firing_rate_recent && (
          <span className="muted small">{card.firing_rate_recent}</span>
        )}
      </h3>

      {!card.enabled ? (
        <div className="muted small" style={{ fontStyle: "italic" }}>
          Disabled in Rules.
        </div>
      ) : !hasFirings ? (
        <div className="muted small" style={{ fontStyle: "italic" }}>
          Nothing flagged in the last sync.
        </div>
      ) : (
        <AnomalyFirings ruleId={card.rule_id} firings={card.firings} />
      )}
    </div>
  );
}

function AnomalyFirings({
  ruleId,
  firings,
}: {
  ruleId: string;
  firings: Record<string, unknown>[];
}) {
  // Render up to 3 firings inline; collapse the rest under "+ N more".
  const visible = firings.slice(0, 3);
  const more = firings.length - visible.length;

  return (
    <>
      {visible.map((f, i) => (
        <FiringRow key={i} ruleId={ruleId} firing={f} />
      ))}
      {more > 0 && (
        <div className="muted small" style={{ marginTop: 6 }}>
          + {more} more
        </div>
      )}
    </>
  );
}

function FiringRow({
  ruleId,
  firing,
}: {
  ruleId: string;
  firing: Record<string, unknown>;
}) {
  // Per-rule rendering — concise, depending on what's in the firing.
  if (ruleId === "velocity-drop") {
    return (
      <div
        className="proto-row"
        style={{ gridTemplateColumns: "1fr auto auto" }}
      >
        <strong>{String(firing.person_display_name ?? "—")}</strong>
        <span className="pill bad">{Number(firing.delta_pct ?? 0).toFixed(0)}%</span>
        <span className="muted small">vs avg</span>
      </div>
    );
  }
  if (ruleId === "stale-carry-over" || ruleId === "aged-blocker") {
    const key = String(firing.issue_key ?? "");
    const label =
      ruleId === "stale-carry-over"
        ? `${firing.depth} sprints`
        : `${firing.age_days} d`;
    return (
      <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <a
          className="jira-link"
          href={`https://eagleeyenetworks.atlassian.net/browse/${key}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {key}
        </a>
        <span className="muted small">{label}</span>
      </div>
    );
  }
  if (ruleId === "epic-risk-regression") {
    const key = String(firing.issue_key ?? "");
    return (
      <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <a
          className="jira-link"
          href={`https://eagleeyenetworks.atlassian.net/browse/${key}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {key}
        </a>
        <span className="muted small">flipped to at-risk</span>
      </div>
    );
  }
  if (ruleId === "project-etd-slippage") {
    return (
      <div className="proto-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <strong>{String(firing.project_name ?? "—")}</strong>
        <span className="pill warn">
          {Number(firing.slip_days ?? 0) > 0 ? "+" : ""}
          {String(firing.slip_days ?? "")} d
        </span>
      </div>
    );
  }
  return (
    <div className="muted small">
      {JSON.stringify(firing).slice(0, 120)}
    </div>
  );
}

function anomalyTone(a: AnomalyCard): "good" | "warn" | "bad" | "neutral" {
  if (!a.enabled) return "neutral";
  const n = a.firings.length;
  if (n === 0) return "good";
  if (a.rule_id === "velocity-drop" || a.rule_id === "epic-risk-regression") {
    return "bad";
  }
  return "warn";
}

// ---- LLM summary tile ------------------------------------------------------

function SummaryTile({ card }: { card: LLMCard }) {
  const dim = card.state === "off" || card.state === "key-missing";
  return (
    <div
      className="panel"
      style={{
        opacity: dim ? 0.65 : 1,
        background: dim ? "var(--color-surface-2)" : "var(--color-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-2)",
        }}
      >
        <strong>{card.title}</strong>
        <StatePill state={card.state} lastRunAt={card.last_run_at} />
      </div>
      <div className="muted small" style={{ marginBottom: "var(--space-2)" }}>
        {card.scope_label && card.state !== "off" && card.state !== "key-missing"
          ? <>For <strong>{card.scope_label}</strong>.{" "}</>
          : null}
        {card.description}
      </div>
      <SummaryBody card={card} />
    </div>
  );
}

function SummaryBody({ card }: { card: LLMCard }) {
  if (card.state === "off") {
    return (
      <div className="muted small">
        Disabled. <Link to="/insights/rules">Enable in Rules →</Link>
      </div>
    );
  }
  if (card.state === "key-missing") {
    return (
      <div className="muted small">
        Anthropic API key not configured.{" "}
        <Link to="/insights/rules">Configure in Rules →</Link>
      </div>
    );
  }
  if (card.state === "running") {
    return (
      <div
        style={{
          background: "var(--color-surface-2)",
          padding: "var(--space-2)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--font-size-sm)",
          fontStyle: "italic",
          color: "var(--color-text-muted)",
        }}
      >
        Regenerating — about 5 s.
      </div>
    );
  }
  if (card.state === "failed") {
    return (
      <div className="muted small" style={{ color: "var(--color-bad-fg)" }}>
        {card.error_message ?? "Last run failed."}
      </div>
    );
  }
  if (card.state === "no-output") {
    return (
      <div className="muted small" style={{ fontStyle: "italic" }}>
        No output yet — first run will trigger automatically.
      </div>
    );
  }
  // fresh
  if (!card.body_md) {
    return <div className="muted small">No body.</div>;
  }
  return (
    <div className="markdown-tight" style={{ fontSize: "var(--font-size-sm)" }}>
      <ReactMarkdown>{card.body_md}</ReactMarkdown>
    </div>
  );
}

function StatePill({
  state,
  lastRunAt,
}: {
  state: LLMCardState;
  lastRunAt: string | null;
}) {
  const styles: Record<
    LLMCardState,
    { tone: "good" | "warn" | "bad" | "neutral"; label: string }
  > = {
    fresh: { tone: "good", label: lastRunAt ? `fresh · ${fmtRelative(lastRunAt)}` : "fresh" },
    running: { tone: "warn", label: "running…" },
    off: { tone: "neutral", label: "off" },
    failed: { tone: "bad", label: "failed" },
    "key-missing": { tone: "neutral", label: "needs API key" },
    "no-output": { tone: "neutral", label: "no output yet" },
  };
  const s = styles[state];
  return <span className={`pill ${s.tone}`}>{s.label}</span>;
}
