/**
 * Leaves page — Phase 5 polish.
 *
 * Layout (matches the Phase-2 mockup):
 *   - "Add leave" form (person dropdown, start/end, reason, Add button)
 *   - "Upcoming (next N weeks)" table with delete buttons
 *   - "Overlap alerts" panels — weeks with ≥2 people away
 *   - "Holidays" mini-list at the bottom (read-only, region from settings)
 *
 * Backend endpoints all already exist; this is just the wiring.
 */

import { useMemo, useState } from "react";

import {
  useCreateLeave,
  useDeleteHoliday,
  useDeleteLeave,
  useHolidays,
  useLeavesInRange,
  usePeople,
  useSettings,
  useUpcomingLeaves,
  useUpsertHoliday,
} from "../../api";
import type { Leave } from "../../api/types";
import InfoIcon from "../../components/InfoIcon";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function LeavesPage() {
  return (
    <div>
      <h1>Leaves</h1>
      <p className="muted">
        Add upcoming leaves so velocity adjusts. Overlap alerts surface when
        2+ people are away in the same week.
      </p>

      <AddLeaveForm />
      <UpcomingTable />
      <OverlapAlerts />
      <PastLeavesTable />
      <HolidaysList />
    </div>
  );
}

// ---- Add leave form --------------------------------------------------------

function AddLeaveForm() {
  const people = usePeople({ teamOnly: true });
  const create = useCreateLeave();
  const [personId, setPersonId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sortedPeople = useMemo(() => {
    return (people.data ?? []).slice().sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );
  }, [people.data]);

  const canSubmit = !!personId && !!start && !!end && !create.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    create.mutate(
      {
        person_account_id: personId,
        start_date: start,
        end_date: end,
        reason: reason || undefined,
      },
      {
        onSuccess: () => {
          setPersonId("");
          setStart("");
          setEnd("");
          setReason("");
        },
        onError: (e: unknown) => {
          const m =
            e instanceof Error
              ? e.message
              : typeof e === "string"
                ? e
                : "Failed to add leave";
          setError(m);
        },
      }
    );
  };

  return (
    <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
      <h3 style={{ marginTop: 0 }}>Add leave</h3>
      <form
        onSubmit={submit}
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 1fr 2fr auto",
          gap: "var(--space-2)",
          alignItems: "end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", fontSize: "var(--font-size-sm)" }}>
          <span className="muted small">Person</span>
          <select
            className="input"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            disabled={people.isLoading}
            style={inputStyle}
          >
            <option value="">— select —</option>
            {sortedPeople.map((p) => (
              <option key={p.account_id} value={p.account_id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "var(--font-size-sm)" }}>
          <span className="muted small">Start</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "var(--font-size-sm)" }}>
          <span className="muted small">End</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "var(--font-size-sm)" }}>
          <span className="muted small">Reason</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="vacation / sick / …"
            style={inputStyle}
          />
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: "8px 14px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-accent)",
            background: "var(--color-accent)",
            color: "#fff",
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.5,
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
          }}
        >
          {create.isPending ? "Adding…" : "Add"}
        </button>
      </form>
      {error && (
        <div className="pill bad" style={{ marginTop: "var(--space-2)", display: "inline-block" }}>
          {error}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: "var(--font-size-sm)",
  fontFamily: "inherit",
};

// ---- Upcoming table --------------------------------------------------------

function UpcomingTable() {
  const upcoming = useUpcomingLeaves(6);
  const del = useDeleteLeave();

  if (upcoming.isLoading) return <div className="muted">Loading…</div>;
  const data = upcoming.data;
  if (!data) return null;

  // Flatten people-windows back into a flat sorted leave list for the table.
  const all: Leave[] = [];
  for (const p of data.people) {
    for (const l of p.leaves) all.push(l);
  }
  all.sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <>
      <h2>
        Upcoming (next 6 weeks){" "}
        <span className="muted small">
          {data.window_start} → {data.window_end}
        </span>
      </h2>
      {all.length === 0 ? (
        <div className="muted small" style={{ marginBottom: "var(--space-4)" }}>
          Nothing scheduled in this window.
        </div>
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
                <th>Person</th>
                <th>Start</th>
                <th>End</th>
                <th>
                  Working days{" "}
                  <InfoIcon text="Weekdays in [start, end] minus holidays for the team's region. Sat/Sun are always excluded; entries in the holidays list (e.g. May 1 Labour Day) are also skipped." />
                </th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {all.map((l) => {
                return (
                  <tr key={l.id}>
                    <td>{l.person_display_name ?? l.person_account_id}</td>
                    <td>{fmtDate(l.start_date)}</td>
                    <td>{fmtDate(l.end_date)}</td>
                    <td>{l.working_days ?? "—"}</td>
                    <td>
                      {l.reason || <span className="muted">—</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete leave for ${l.person_display_name ?? l.person_account_id} (${l.start_date} → ${l.end_date})?`
                            )
                          ) {
                            del.mutate(l.id);
                          }
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--color-text-muted)",
                          fontSize: 18,
                          lineHeight: 1,
                          padding: "2px 8px",
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- Overlap alerts --------------------------------------------------------

function OverlapAlerts() {
  const upcoming = useUpcomingLeaves(6);
  const alerts = upcoming.data?.overlap_alerts ?? [];
  if (alerts.length === 0) return null;

  return (
    <>
      <h2>
        Overlap alerts{" "}
        <InfoIcon text="Weeks where 2+ people are scheduled to be away at the same time. The week_start is the Monday of the affected week." />
      </h2>
      <div className="three-panel">
        {alerts.map((a) => (
          <div
            key={a.week_start}
            className="panel"
            style={{ borderLeft: "4px solid var(--color-warn)" }}
          >
            <strong>Week of {fmtDate(a.week_start)}</strong>
            <div className="muted small">
              {a.people_count} people away
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginTop: "var(--space-2)",
              }}
            >
              {a.people.map((id) => (
                <span key={id} className="pill warn">
                  {idToName(upcoming.data?.people ?? [], id)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function idToName(
  people: { person_account_id: string; person_display_name: string | null }[],
  id: string
): string {
  const m = people.find((p) => p.person_account_id === id);
  return m?.person_display_name ?? id;
}

// ---- Past leaves -----------------------------------------------------------

function PastLeavesTable() {
  const [days, setDays] = useState(90);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [days]);
  const { data, isLoading } = useLeavesInRange(from, today);
  const del = useDeleteLeave();

  // Backend returns leaves overlapping [from, today]. We want strictly
  // past leaves — i.e. ones whose end_date is before today.
  const past = useMemo(() => {
    return (data ?? [])
      .filter((l) => l.end_date < today)
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [data, today]);

  return (
    <>
      <h2 style={{ marginTop: "var(--space-6)" }}>
        Past leaves{" "}
        <span className="muted small">(last {days} days)</span>{" "}
        <InfoIcon text="Leaves whose end date is before today, ending in the chosen window. Useful for reviewing completed time-off when reasoning about velocity in past sprints." />
      </h2>
      <div
        style={{
          marginBottom: "var(--space-2)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--color-text-muted)",
          }}
        >
          Window
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            style={{
              padding: "4px 8px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              fontSize: "var(--font-size-sm)",
              fontFamily: "inherit",
            }}
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
          </select>
        </label>
      </div>
      {isLoading ? (
        <div className="muted small">Loading…</div>
      ) : past.length === 0 ? (
        <div
          className="muted small"
          style={{ marginBottom: "var(--space-4)" }}
        >
          No past leaves in this window.
        </div>
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
                <th>Person</th>
                <th>Start</th>
                <th>End</th>
                <th>Days</th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {past.map((l) => {
                const days =
                  Math.floor(
                    (new Date(l.end_date).getTime() -
                      new Date(l.start_date).getTime()) /
                      86_400_000,
                  ) + 1;
                return (
                  <tr key={l.id}>
                    <td>{l.person_display_name ?? l.person_account_id}</td>
                    <td>{fmtDate(l.start_date)}</td>
                    <td>{fmtDate(l.end_date)}</td>
                    <td>{days}</td>
                    <td>{l.reason || <span className="muted">—</span>}</td>
                    <td>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete leave for ${l.person_display_name ?? l.person_account_id} (${l.start_date} → ${l.end_date})?`,
                            )
                          ) {
                            del.mutate(l.id);
                          }
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--color-text-muted)",
                          fontSize: 18,
                          lineHeight: 1,
                          padding: "2px 8px",
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- Holidays --------------------------------------------------------------

function HolidaysList() {
  const settings = useSettings();
  const region = settings.data?.team_region ?? "IN";
  const holidays = useHolidays(region);
  const upsert = useUpsertHoliday();
  const del = useDeleteHoliday();

  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (holidays.data ?? [])
      .filter((h) => h.holiday_date >= today)
      .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
      .slice(0, 20);
  }, [holidays.data]);

  const canSubmit = !!date && !!name && !upsert.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    upsert.mutate(
      { holiday_date: date, region, name },
      {
        onSuccess: () => {
          setDate("");
          setName("");
        },
        onError: (err: unknown) => {
          const m =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : "Failed to add holiday";
          setError(m);
        },
      }
    );
  };

  return (
    <>
      <h2>
        Holidays <span className="muted small">({region})</span>{" "}
        <InfoIcon text="Team-wide non-working days. Working-day calculations (sprint capacity, available days) treat these as off — same as weekends." />
      </h2>

      <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
        <h3 style={{ marginTop: 0 }}>Add holiday</h3>
        <form
          onSubmit={submit}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2.5fr auto",
            gap: "var(--space-2)",
            alignItems: "end",
          }}
        >
          <label
            style={{ display: "flex", flexDirection: "column", fontSize: "var(--font-size-sm)" }}
          >
            <span className="muted small">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label
            style={{ display: "flex", flexDirection: "column", fontSize: "var(--font-size-sm)" }}
          >
            <span className="muted small">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Independence Day, Team offsite"
              style={inputStyle}
            />
          </label>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: "8px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-accent)",
              background: "var(--color-accent)",
              color: "#fff",
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.5,
              fontSize: "var(--font-size-sm)",
              fontWeight: 500,
            }}
          >
            {upsert.isPending ? "Adding…" : "Add"}
          </button>
        </form>
        <div className="muted small" style={{ marginTop: "var(--space-1)" }}>
          Idempotent on <code>(date, region)</code> — re-adding the same date
          updates the name.
        </div>
        {error && (
          <div
            className="pill bad"
            style={{ marginTop: "var(--space-2)", display: "inline-block" }}
          >
            {error}
          </div>
        )}
      </div>

      {upcoming.length === 0 ? (
        <div className="muted small">
          No upcoming holidays for region {region}.
        </div>
      ) : (
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-3)",
            maxWidth: 560,
          }}
        >
          <table className="datatable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((h) => (
                <tr key={h.holiday_date}>
                  <td>{fmtDate(h.holiday_date)}</td>
                  <td>{h.name}</td>
                  <td>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => {
                        if (
                          confirm(
                            `Delete holiday "${h.name}" on ${h.holiday_date}?`
                          )
                        ) {
                          del.mutate({
                            region: h.region,
                            date: h.holiday_date,
                          });
                        }
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--color-text-muted)",
                        fontSize: 18,
                        lineHeight: 1,
                        padding: "2px 8px",
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
