// Health check + setup-gate hook. Used by App.tsx to route to /setup when needed.

export interface HealthResponse {
  status: string;
  configured: boolean;
  jira: "configured" | "unconfigured";
  version: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/v1/health");
  if (!res.ok) {
    throw new Error(`Health endpoint returned ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
