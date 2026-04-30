import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

interface SetupResponse {
  ok: boolean;
  account_id?: string;
  display_name?: string;
  message: string;
}

export default function Setup() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = async (path: "test" | "jira") => {
    if (!email || !token) {
      setResult({ kind: "err", text: "Email and API token required." });
      return;
    }
    setResult(null);
    if (path === "test") setTesting(true); else setSaving(true);
    try {
      const res = await fetch(`/api/v1/setup/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, api_token: token }),
      });
      const body = (await res.json()) as SetupResponse | { detail?: { message: string } };
      if (!res.ok) {
        const detail = (body as { detail?: { message: string } }).detail;
        setResult({
          kind: "err",
          text: detail?.message ?? `Request failed (${res.status}).`,
        });
        return;
      }
      const ok = body as SetupResponse;
      if (path === "jira") {
        setResult({
          kind: "ok",
          text: `Saved. Authenticated as ${ok.display_name ?? ok.account_id ?? "user"}.`,
        });
        // Force an immediate re-poll so the unconfigured guard releases.
        await qc.invalidateQueries({ queryKey: ["health"] });
        setTimeout(() => navigate("/debug"), 800);
      } else {
        setResult({
          kind: "ok",
          text: `Connection OK — ${ok.display_name ?? ok.account_id}.`,
        });
      }
    } catch (e) {
      setResult({ kind: "err", text: `Network error: ${(e as Error).message}` });
    } finally {
      setTesting(false);
      setSaving(false);
    }
  };

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 480,
        margin: "5rem auto",
        padding: 24,
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Set up team-lens</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Connect your Jira account. Credentials are stored in <code>backend/.env</code> and never
        leave this machine.
      </p>

      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={{ display: "block", marginBottom: 4 }}>Jira email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@eagleeyenetworks.com"
          style={{
            width: "100%",
            padding: 8,
            fontSize: 14,
            border: "1px solid #ccc",
            borderRadius: 4,
          }}
          autoComplete="username"
        />
      </label>

      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ display: "block", marginBottom: 4 }}>Jira API token</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste from id.atlassian.com/manage-profile/security/api-tokens"
          style={{
            width: "100%",
            padding: 8,
            fontSize: 14,
            border: "1px solid #ccc",
            borderRadius: 4,
          }}
          autoComplete="current-password"
        />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => submit("test")}
          disabled={testing || saving}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            border: "1px solid #aaa",
            borderRadius: 4,
            background: "white",
            cursor: testing ? "wait" : "pointer",
          }}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button
          type="button"
          onClick={() => submit("jira")}
          disabled={testing || saving}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            border: "1px solid #1a73e8",
            borderRadius: 4,
            background: "#1a73e8",
            color: "white",
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {result && (
        <div
          style={{
            marginTop: 16,
            padding: 10,
            borderRadius: 4,
            background: result.kind === "ok" ? "#e6f4ea" : "#fce8e6",
            color: result.kind === "ok" ? "#137333" : "#a50e0e",
            fontSize: 14,
          }}
          role="status"
        >
          {result.text}
        </div>
      )}
    </main>
  );
}
