import { Navigate, Route, Routes } from "react-router-dom";

import { useHealth } from "./api";
import AppShell from "./components/AppShell";
import EpicRiskPage from "./features/epic-risk/EpicRiskPage";
import HygienePage from "./features/hygiene/HygienePage";
import InsightsPage from "./features/insights/InsightsPage";
import InsightsRulesPage from "./features/insights/InsightsRulesPage";
import LeaderboardPage from "./features/leaderboard/LeaderboardPage";
import LeavesPage from "./features/leaves/LeavesPage";
import NotesPage from "./features/notes/NotesPage";
import ProjectDetailPage from "./features/projects/ProjectDetailPage";
import ProjectsMonitoringPage from "./features/projects/ProjectsMonitoringPage";
import ProjectsPage from "./features/projects/ProjectsPage";
import SprintHealthPage from "./features/sprint-health/SprintHealthPage";
import StandupBoard from "./features/sprint-health/StandupBoard";
import Debug from "./pages/Debug";
import SettingsPage from "./pages/Settings";
import Setup from "./pages/Setup";


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
              <Route path="/standup" element={<StandupBoard />} />
              <Route path="/epic-risk" element={<EpicRiskPage />} />
              <Route path="/hygiene" element={<HygienePage />} />
              <Route path="/leaves" element={<LeavesPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route
                path="/projects/monitoring"
                element={<ProjectsMonitoringPage />}
              />
              <Route path="/projects/:name" element={<ProjectDetailPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/insights/rules" element={<InsightsRulesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/debug" replace />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
