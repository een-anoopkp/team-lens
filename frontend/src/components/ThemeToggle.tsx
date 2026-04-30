/**
 * Theme toggle for the top bar. Stores preference in localStorage so it
 * persists across reloads. Designed in Phase 2.1 + 2.2; wired in Phase 4.5.
 */

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "tl.theme";

function getInitial(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(t: Theme) {
  if (t === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitial);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} theme`}
      style={{
        padding: "6px 10px",
        fontSize: 14,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
        cursor: "pointer",
      }}
    >
      {theme === "dark" ? "☀" : "🌙"}
    </button>
  );
}
