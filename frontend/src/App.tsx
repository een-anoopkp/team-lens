import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { fetchHealth } from "./api/health";
import Setup from "./pages/Setup";

function PlaceholderPage({ phase, name }: { phase: number; name: string }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>{name}</h1>
      <p style={{ color: "#666" }}>Coming in Phase {phase}.</p>
    </main>
  );
}

function DebugPlaceholder() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>/debug</h1>
      <p>The full /debug page lands in step 1.10.</p>
      <p>Backend health endpoint: <code>GET /api/v1/health</code></p>
    </main>
  );
}

export default function App() {
  const { data, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        Loading…
      </main>
    );
  }

  // If unconfigured, anything except /setup itself routes to /setup
  const requireSetup = data && !data.configured;

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      {requireSetup ? (
        <Route path="*" element={<Navigate to="/setup" replace />} />
      ) : (
        <>
          <Route path="/" element={<Navigate to="/debug" replace />} />
          <Route path="/debug" element={<DebugPlaceholder />} />
          <Route path="/sprint-health" element={<PlaceholderPage phase={3} name="Sprint Health" />} />
          <Route path="/epic-risk" element={<PlaceholderPage phase={4} name="Epic Risk" />} />
          <Route path="/hygiene" element={<PlaceholderPage phase={4} name="Hygiene" />} />
          <Route path="/projects" element={<PlaceholderPage phase={5} name="Projects" />} />
          <Route path="/leaderboard" element={<PlaceholderPage phase={5} name="Leaderboard" />} />
          <Route path="/insights" element={<PlaceholderPage phase={5} name="Insights" />} />
          <Route path="*" element={<Navigate to="/debug" replace />} />
        </>
      )}
    </Routes>
  );
}
