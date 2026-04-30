import { Navigate, Route, Routes } from "react-router-dom";

import { useHealth } from "./api";
import AppShell from "./components/AppShell";
import EpicRiskPage from "./features/epic-risk/EpicRiskPage";
import HygienePage from "./features/hygiene/HygienePage";
import ProjectDetailPage from "./features/projects/ProjectDetailPage";
import ProjectsPage from "./features/projects/ProjectsPage";
import SprintHealthPage from "./features/sprint-health/SprintHealthPage";
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
              <Route path="/sprint-health" element={<SprintHealthPage />} />
              <Route path="/epic-risk" element={<EpicRiskPage />} />
              <Route path="/hygiene" element={<HygienePage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:name" element={<ProjectDetailPage />} />
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
