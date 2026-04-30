/**
 * Settings page — read-only first cut.
 *
 * Shows the current runtime config (Jira creds masked, schedule + next runs,
 * team filter) plus a "Re-test connection" button that hits the live Jira
 * tenant with the currently-saved creds. No editing yet — to change values
 * you still edit `backend/.env` and restart, OR re-POST to /setup/jira.
 */

import { useState } from "react";

import { useSettings, useSyncStatus, useTestCurrentCreds } from "../api";
import type { TestConnectionResponse } from "../api/types";
import InfoIcon from "../components/InfoIcon";

function fmtCronNext(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describeCron(expr: string): string {
  // Best-effort, English-ish summary for the common shapes we use.
  // Falls back to the raw expression for anything custom.
  const m = expr.trim().match(/^(\S+)\s+(\S+)\s+\*\s+\*\s+(\S+)$/);
  if (!m) return expr;
  const [, minute, hour, dow] = m;
  if (dow === "0") return `weekly Sun · ${hour}:${minute.padStart(2, "0")}`;
  if (dow !== "*") return expr;
  // Daily-ish: hour may be a comma-list (e.g. "7,11,15,19").
  const hours = hour.split(",");
  if (hours.length === 1) return `daily · ${hour}:${minute.padStart(2, "0")}`;
  return `${hours.length}× daily · ${hours.join(", ")}`;
}

export default function Settings() {
  const settings = useSettings();
  const sync = useSyncStatus();
  const testMut = useTestCurrentCreds();
  const [testResult, setTestResult] = useState<
    | { kind: "ok"; r: TestConnectionResponse }
    | { kind: "err"; message: string }
    | null
  >(null);

  if (settings.isLoading) return <div className="muted">Loading…</div>;
  if (!settings.data) return <div className="muted">Failed to load settings.</div>;

  const s = settings.data;
  const nextInc = sync.data?.scheduled?.find(
    (j) => j.id === "sync_incremental"
  )?.next_run_at;
  const nextFull = sync.data?.scheduled?.find((j) => j.id === "sync_full")
    ?.next_run_at;

  const onRetest = () => {
    setTestResult(null);
    testMut.mutate(undefined, {
      onSuccess: (r) => setTestResult({ kind: "ok", r }),
      onError: (e: unknown) => {
        const message =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Connection test failed";
        setTestResult({ kind: "err", message });
      },
    });
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Settings</h1>
      <p className="muted">
        Read-only view of the current runtime config. To change a value, edit{" "}
        <code>backend/.env</code> and restart, or re-POST to{" "}
        <code>/api/v1/setup/jira</code> for credentials.
      </p>

      <h2>Jira credentials</h2>
      <div className="panel">
        <Row label="Email">
          <code>{s.jira_email || "—"}</code>
        </Row>
        <Row label="API token">
          <code>
            {s.api_token_last4
              ? `••••••••••${s.api_token_last4}`
              : "not set"}
          </code>
        </Row>
        <Row label="Base URL">
          <code>{s.jira_base_url}</code>
        </Row>
        <Row label="">
          <button
            type="button"
            onClick={onRetest}
            disabled={!s.configured || testMut.isPending}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-2)",
              cursor: testMut.isPending ? "wait" : "pointer",
              fontSize: "var(--font-size-sm)",
            }}
          >
            {testMut.isPending ? "Testing…" : "Re-test connection"}
          </button>
        </Row>
        {testResult && (
          <div
            className={
              testResult.kind === "ok"
                ? "pill good"
                : "pill bad"
            }
            style={{ marginTop: "var(--space-2)", display: "inline-block" }}
          >
            {testResult.kind === "ok"
              ? `${testResult.r.message} Logged in as ${testResult.r.display_name}.`
              : testResult.message}
          </div>
        )}
      </div>

      <h2>Sync schedule</h2>
      <div className="panel">
        <Row
          label={
            <>
              Incremental cron <InfoIcon text="Light, fast sync — pulls only issues updated since the last successful run. Default 4× daily so labels and edits propagate within ~4 hours." />
            </>
          }
        >
          <code>{s.sync_cron}</code>{" "}
          <span className="muted small">— {describeCron(s.sync_cron)}</span>
        </Row>
        <Row label="Next incremental">
          <strong>{fmtCronNext(nextInc ?? null)}</strong>
        </Row>
        <Row
          label={
            <>
              Full-scan cron <InfoIcon text="Heavy weekly resync — re-fetches every Search-team issue and reconciles snapshots. Used to catch deletes / out-of-band changes that incrementals can miss." />
            </>
          }
        >
          <code>{s.full_scan_cron}</code>{" "}
          <span className="muted small">— {describeCron(s.full_scan_cron)}</span>
        </Row>
        <Row label="Next full scan">
          <strong>{fmtCronNext(nextFull ?? null)}</strong>
        </Row>
      </div>

      <h2>Team filter</h2>
      <div className="panel">
        <Row
          label={
            <>
              Custom field <InfoIcon text="Jira custom field used for the team membership predicate in every search JQL." />
            </>
          }
        >
          <code>{s.jira_team_field}</code>
        </Row>
        <Row label="Team UUID">
          <code>{s.jira_team_value_masked}</code>
        </Row>
        <Row label="Board">
          <code>#{s.jira_board_id}</code>
        </Row>
        <Row
          label={
            <>
              Sprint name prefix <InfoIcon text="Sprints whose names start with this prefix are kept; others (e.g. cross-team or planning sprints) are filtered out before they hit our DB." />
            </>
          }
        >
          <code>{s.jira_sprint_name_prefix}</code>
        </Row>
        <Row label="Holiday region">
          <code>{s.team_region}</code>
        </Row>
      </div>

      <h2>Holidays + leaves</h2>
      <p className="muted small">
        Managed via <code>/api/v1/leaves</code> and{" "}
        <code>/api/v1/holidays</code>. UI for these lands when needed —
        until then, see <code>backend/app/api/routes_leaves.py</code>.
      </p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="proto-row"
      style={{ gridTemplateColumns: "200px 1fr", padding: "var(--space-1) 0" }}
    >
      <span className="muted small">{label}</span>
      <span>{children}</span>
    </div>
  );
}
