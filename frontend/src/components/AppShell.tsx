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
  /** Sub-pages — rendered indented underneath the parent. Always visible. */
  children?: NavItem[];
}

const NAV: NavItem[] = [
  { to: "/sprint-health", label: "Sprint Health" },
  { to: "/standup", label: "Standup Board" },
  { to: "/epic-risk", label: "Epic Risk" },
  { to: "/hygiene", label: "Hygiene" },
  { to: "/leaves", label: "Leaves" },
  { to: "/notes", label: "Notes" },
  {
    to: "/projects",
    label: "Projects",
    children: [{ to: "/projects/monitoring", label: "Monitoring" }],
  },
  { to: "/leaderboard", label: "Leaderboard" },
  {
    to: "/insights",
    label: "Insights",
    children: [{ to: "/insights/rules", label: "Rules" }],
  },
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
        // Pin the layout to viewport height; only <main> scrolls so the
        // header and sidebar stay put while reading long pages.
        height: "100vh",
        overflow: "hidden",
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

      <NavSidebar />

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

function NavSidebar() {
  return (
    <nav
      style={{
        gridArea: "side",
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        padding: "12px 0",
        // Sidebar can scroll independently if the nav grows beyond
        // viewport height — main content scrolling stays unaffected.
        overflowY: "auto",
      }}
    >
      {NAV.map((item) => (
        <NavGroup key={item.to} item={item} />
      ))}
    </nav>
  );
}

function NavGroup({ item }: { item: NavItem }) {
  return (
    <>
      <NavRow item={item} depth={0} />
      {item.children?.map((c) => (
        <NavRow key={c.to} item={c} depth={1} />
      ))}
    </>
  );
}

function NavRow({
  item,
  depth,
}: {
  item: NavItem;
  depth: number;
}) {
  const paddingLeft = depth === 0 ? 16 : 36; // 16 base + 20 indent
  // Use end-match on rows that have children OR are children themselves.
  // Otherwise NavLink would highlight `/projects` while on `/projects/monitoring`.
  const exactMatch = depth > 0 || (item.children?.length ?? 0) > 0;
  return (
    <NavLink
      to={item.to}
      end={exactMatch}
      style={({ isActive }) => ({
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: `8px 16px 8px ${paddingLeft}px`,
        color: isActive ? "var(--color-accent)" : "var(--color-text)",
        background: isActive ? "rgba(26,115,232,0.08)" : "transparent",
        borderLeft: isActive
          ? "3px solid var(--color-accent)"
          : "3px solid transparent",
        fontSize: depth === 0 ? 14 : 13,
        fontWeight: isActive ? 600 : 400,
      })}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {depth > 0 && (
          <span
            aria-hidden="true"
            style={{
              color: "var(--color-text-muted)",
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            ↳
          </span>
        )}
        {item.label}
      </span>
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
  );
}
