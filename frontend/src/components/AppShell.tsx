import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import RefreshButton from "./RefreshButton";
import StalenessBadge from "./StalenessBadge";
import ThemeToggle from "./ThemeToggle";
import { useSyncCompletionInvalidator } from "../lib/sync-watcher";

interface NavItem {
  to: string;
  label: string;
  /** Tag shown next to the label (e.g. "v3") for routes that are
   *  empty-state placeholders for not-yet-built work. */
  tag?: string;
}

const NAV: NavItem[] = [
  { to: "/sprint-health", label: "Sprint Health" },
  { to: "/epic-risk", label: "Epic Risk" },
  { to: "/hygiene", label: "Hygiene" },
  { to: "/leaves", label: "Leaves" },
  { to: "/projects", label: "Projects" },
  { to: "/projects/monitoring", label: "Projects · Monitoring" },
  { to: "/leaderboard", label: "Leaderboard", tag: "v3" },
  { to: "/insights", label: "Insights", tag: "v3" },
  { to: "/debug", label: "Debug" },
  { to: "/settings", label: "Settings" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  // Watch sync runs and invalidate every cached query the moment one
  // completes — so the page picks up new data without a manual refresh.
  useSyncCompletionInvalidator();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gridTemplateRows: "56px 1fr",
        gridTemplateAreas: '"top top" "side main"',
      }}
    >
      <header
        style={{
          gridArea: "top",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-4)",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div style={{ fontWeight: 600 }}>team-lens</div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <StalenessBadge />
          <RefreshButton />
          <ThemeToggle />
        </div>
      </header>

      <nav
        style={{
          gridArea: "side",
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-border)",
          padding: "12px 0",
        }}
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 16px",
              color: isActive ? "var(--color-accent)" : "var(--color-text)",
              background: isActive ? "rgba(26,115,232,0.08)" : "transparent",
              borderLeft: isActive
                ? "3px solid var(--color-accent)"
                : "3px solid transparent",
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
            })}
          >
            <span>{item.label}</span>
            {item.tag && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--color-text-muted)",
                  background: "rgba(0,0,0,0.05)",
                  padding: "2px 6px",
                  borderRadius: 999,
                }}
                title={`Placeholder — lands in ${item.tag}`}
              >
                {item.tag}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <main
        style={{
          gridArea: "main",
          padding: "var(--space-5)",
          overflowY: "auto",
        }}
      >
        {children}
      </main>
    </div>
  );
}
