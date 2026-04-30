/**
 * Sprint-Health parent layout — renders the tab strip ("Health" /
 * "Standup Board") and an <Outlet /> for the active tab body.
 *
 * Each tab is a sibling under this layout and picks its own sprint
 * (Health: active or most-recent closed; Standup Board: active only).
 * Sprint state is not lifted up here because the two tabs serve
 * different scopes — sharing would only confuse closed-sprint review.
 */

import { NavLink, Outlet } from "react-router-dom";

const TAB_STYLE_BASE: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "var(--radius-md)",
  textDecoration: "none",
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
  color: "var(--color-text-muted)",
  border: "1px solid transparent",
};

const TAB_STYLE_ACTIVE: React.CSSProperties = {
  ...TAB_STYLE_BASE,
  color: "var(--color-text)",
  background: "var(--color-surface)",
  borderColor: "var(--color-border)",
};

export default function SprintHealthLayout() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: "var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: "var(--space-2)",
        }}
      >
        <NavLink
          to="/sprint-health"
          end
          style={({ isActive }) =>
            isActive ? TAB_STYLE_ACTIVE : TAB_STYLE_BASE
          }
        >
          Health
        </NavLink>
        <NavLink
          to="/sprint-health/board"
          style={({ isActive }) =>
            isActive ? TAB_STYLE_ACTIVE : TAB_STYLE_BASE
          }
        >
          Standup Board
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}
