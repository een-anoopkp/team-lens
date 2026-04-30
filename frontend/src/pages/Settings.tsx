/**
 * Settings page — read-only first cut.
 *
 * Shows the current runtime config (Jira creds masked, schedule + next runs,
 * team filter) plus a "Re-test connection" button that hits the live Jira
 * tenant with the currently-saved creds. No editing yet — to change values
 * you still edit `backend/.env` and restart, OR re-POST to /setup/jira.
 */

import React, { useState } from "react";

import {
  useAddTeamMember,
  usePeople,
  useRemoveTeamMember,
  useSeedTeamMembers,
  useSettings,
  useSyncStatus,
  useTeamMembers,
  useTestCurrentCreds,
  useUpdateTeamMember,
} from "../api";
import type { TeamMember, TestConnectionResponse } from "../api/types";
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

      <h2>
        Team members{" "}
        <InfoIcon text="Whitelist of current Search-team members. Drives the Leaderboard rows + the Leave-add dropdown. Sprint Health and project drill-ins ignore this list and keep showing whoever did the work historically. Maintain explicitly — sync does not auto-add or remove." />
      </h2>
      <TeamMembersSection />

      <h2>
        Insights — Anthropic API key{" "}
        <InfoIcon text="Required only for the LLM rules on /insights. Stored in backend/.env as ANTHROPIC_API_KEY. Never returned by any endpoint — only the last 4 chars are shown." />
      </h2>
      <div className="panel">
        <Row label="Status">
          {s.anthropic_configured ? (
            <span className="pill good">configured</span>
          ) : (
            <span className="pill warn">not set — LLM rules will fail</span>
          )}
        </Row>
        <Row label="Key">
          <code>
            {s.anthropic_key_last4
              ? `••••••••••${s.anthropic_key_last4}`
              : "not set"}
          </code>
        </Row>
        <Row label="Model">
          <code>{s.anthropic_model}</code>
        </Row>
        <Row label="">
          <span className="muted small">
            To change either, edit <code>backend/.env</code> and restart
            the backend.
          </span>
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

function TeamMembersSection() {
  const members = useTeamMembers();
  const people = usePeople(); // all known assignees
  const add = useAddTeamMember();
  const seed = useSeedTeamMembers();
  const [picked, setPicked] = React.useState("");
  const [seedResult, setSeedResult] = React.useState<string | null>(null);

  const memberIds = new Set((members.data ?? []).map((m) => m.account_id));
  const candidates = (people.data ?? [])
    .filter((p) => !memberIds.has(p.account_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const onAdd = () => {
    if (!picked) return;
    add.mutate(picked, { onSuccess: () => setPicked("") });
  };

  const onSeed = () => {
    setSeedResult(null);
    seed.mutate(60, {
      onSuccess: (r) => {
        setSeedResult(
          r.added.length === 0
            ? `No new candidates from the last 60 days. ${r.kept} kept.`
            : `Added ${r.added.length} from recent activity: ${r.added.slice(0, 6).join(", ")}${r.added.length > 6 ? "…" : ""}`
        );
      },
    });
  };

  return (
    <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Currently <strong>{members.data?.length ?? 0}</strong> on the
        team. Add anyone the search picker is missing; remove with ×.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "var(--space-3)" }}>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: "var(--font-size-sm)",
            minWidth: 280,
          }}
        >
          <option value="">— pick a person to add —</option>
          {candidates.map((p) => (
            <option key={p.account_id} value={p.account_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onAdd}
          disabled={!picked || add.isPending}
          style={addButtonStyle(!!picked && !add.isPending)}
        >
          {add.isPending ? "Adding…" : "Add"}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onSeed}
          disabled={seed.isPending}
          title="Add anyone who's been an assignee on a non-removed issue in the last 60 days. Useful first time; usually you'll want to prune."
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-2)",
            color: "var(--color-text)",
            cursor: seed.isPending ? "wait" : "pointer",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {seed.isPending ? "Seeding…" : "Seed from recent activity"}
        </button>
      </div>

      {seedResult && (
        <div className="muted small" style={{ marginBottom: "var(--space-2)" }}>
          {seedResult}
        </div>
      )}

      {members.data && members.data.length === 0 ? (
        <div className="muted small">
          No members yet. Click <em>Seed from recent activity</em> for a
          starting list, then prune anyone not actually on the team.
        </div>
      ) : (
        <TeamMembersTable members={members.data ?? []} />
      )}
    </div>
  );
}

function TeamMembersTable({ members }: { members: TeamMember[] }) {
  const remove = useRemoveTeamMember();
  const update = useUpdateTeamMember();

  return (
    <table
      className="datatable"
      style={{ background: "var(--color-surface)" }}
    >
      <thead>
        <tr>
          <th>Name</th>
          <th style={{ width: 200 }}>
            Counts for capacity{" "}
            <InfoIcon text="When ON, this person's tickets and available days drive Sprint Health velocity + Person-days. Turn OFF for leads who don't own tickets, embedded QA on a separate flow, etc. They stay in the Leave dropdown either way." />
          </th>
          <th style={{ width: 60 }}></th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.account_id}>
            <td>
              {m.display_name ?? m.account_id}
              {!m.counts_for_capacity && (
                <span
                  className="pill neutral"
                  style={{ marginLeft: 8, fontSize: 10 }}
                >
                  not in capacity
                </span>
              )}
            </td>
            <td>
              <CapacityToggle
                checked={m.counts_for_capacity}
                onChange={(v) =>
                  update.mutate({
                    account_id: m.account_id,
                    counts_for_capacity: v,
                  })
                }
              />
            </td>
            <td>
              <button
                type="button"
                title={`Remove ${m.display_name ?? m.account_id} from the team`}
                onClick={() => {
                  if (
                    confirm(
                      `Remove ${m.display_name ?? m.account_id} from the team?`
                    )
                  ) {
                    remove.mutate(m.account_id);
                  }
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CapacityToggle({
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

function addButtonStyle(enabled: boolean): React.CSSProperties {
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
