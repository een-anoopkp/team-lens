import { Navigate, Route, Routes } from "react-router-dom";

import { useHealth } from "./api";
import AppShell from "./components/AppShell";
import Debug from "./pages/Debug";
import Setup from "./pages/Setup";

function PlaceholderPage({ phase, name }: { phase: number; name: string }) {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{name}</h1>
      <p style={{ color: "var(--color-text-muted)" }}>
        Coming in Phase {phase}.
      </p>
    </div>
  );
}

function SettingsPlaceholder() {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Settings</h1>
      <p style={{ color: "var(--color-text-muted)" }}>
        Full settings page (Jira creds re-test, sync schedule, team filter,
        board ID, holidays + leaves management) lands during Phase 2 (UX
        design) and Phase 3 (wired). For now, edit{" "}
        <code>backend/.env</code> directly or re-POST to{" "}
        <code>/api/v1/setup/jira</code>.
      </p>
    </div>
  );
}

export default function App() {
  const { data, isLoading } = useHealth();

  if (isLoading) {
    return (
      <main style={{ padding: 24, fontFamily: "var(--font-stack)" }}>Loading…</main>
    );
  }

  // Pre-setup: route everything except /setup itself to /setup
  if (data && !data.configured) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route
        path="*"
        element={
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/debug" replace />} />
              <Route path="/debug" element={<Debug />} />
              <Route
                path="/sprint-health"
                element={<PlaceholderPage phase={3} name="Sprint Health" />}
              />
              <Route
                path="/epic-risk"
                element={<PlaceholderPage phase={4} name="Epic Risk" />}
              />
              <Route
                path="/hygiene"
                element={<PlaceholderPage phase={4} name="Hygiene" />}
              />
              <Route
                path="/projects"
                element={<PlaceholderPage phase={5} name="Projects" />}
              />
              <Route
                path="/leaderboard"
                element={<PlaceholderPage phase={5} name="Leaderboard" />}
              />
              <Route
                path="/insights"
                element={<PlaceholderPage phase={5} name="Insights" />}
              />
              <Route path="/settings" element={<SettingsPlaceholder />} />
              <Route path="*" element={<Navigate to="/debug" replace />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
