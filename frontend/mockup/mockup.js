/* Mockup glue — hash routing + theme toggle.
 * Dependency-free; ~50 lines on purpose. The React app (Phase 3+) replaces
 * this with react-router-dom + a real query client.
 */

(function () {
  const sections = document.querySelectorAll(".route");
  const navItems = document.querySelectorAll(".nav-item[data-route]");

  function showRoute(route) {
    sections.forEach((s) => {
      s.classList.toggle("hidden", s.dataset.route !== route);
    });
    navItems.forEach((n) => {
      n.classList.toggle("active", n.dataset.route === route);
    });
    if (location.hash !== "#" + route) {
      history.replaceState(null, "", "#" + route);
    }
    window.scrollTo(0, 0);
  }

  function currentRoute() {
    const hash = location.hash.replace(/^#/, "");
    if (hash) return hash;
    return "components";
  }

  navItems.forEach((n) => {
    n.addEventListener("click", (e) => {
      const r = n.dataset.route;
      if (r) {
        e.preventDefault();
        showRoute(r);
      }
    });
  });

  window.addEventListener("hashchange", () => showRoute(currentRoute()));
  showRoute(currentRoute());

  // Theme toggle
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const isDark = document.documentElement.dataset.theme === "dark";
      document.documentElement.dataset.theme = isDark ? "" : "dark";
      toggle.textContent = isDark ? "🌙" : "☀";
    });
  }

  // Refresh-button cycle demo (idle → syncing → success-flash → idle)
  const refresh = document.getElementById("refresh-btn");
  const stalenessPill = document.getElementById("staleness-pill");
  if (refresh && stalenessPill) {
    refresh.addEventListener("click", () => {
      const orig = refresh.textContent;
      const origPill = stalenessPill.textContent;
      const origPillClass = stalenessPill.className;
      refresh.disabled = true;
      refresh.textContent = "↻ Syncing…";
      stalenessPill.textContent = "↻ Syncing…";
      stalenessPill.className = "staleness staleness-neutral";
      setTimeout(() => {
        refresh.textContent = "✓ Synced";
        refresh.style.color = "var(--color-good)";
        stalenessPill.textContent = "● Synced just now";
        stalenessPill.className = "staleness staleness-good";
      }, 1200);
      setTimeout(() => {
        refresh.disabled = false;
        refresh.textContent = orig;
        refresh.style.color = "";
      }, 2200);
    });
  }
})();
