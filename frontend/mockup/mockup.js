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

  // ---- Modal open/close (with focus management + Esc) ---------------
  const openModalBtn = document.getElementById("open-modal");
  const modalOverlay = document.getElementById("modal-overlay");
  const closeModalBtn = document.getElementById("close-modal");
  const modalCancel = document.getElementById("modal-cancel");
  const modalSave = document.getElementById("modal-save");
  let modalReturnFocus = null;
  function openModal() {
    if (!modalOverlay) return;
    modalReturnFocus = document.activeElement;
    modalOverlay.classList.remove("hidden");
    const firstFocusable = modalOverlay.querySelector("input,button");
    firstFocusable && firstFocusable.focus();
  }
  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.add("hidden");
    modalReturnFocus && modalReturnFocus.focus();
  }
  if (openModalBtn) openModalBtn.addEventListener("click", openModal);
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
  if (modalCancel) modalCancel.addEventListener("click", closeModal);
  if (modalSave) modalSave.addEventListener("click", closeModal);
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      modalOverlay &&
      !modalOverlay.classList.contains("hidden")
    ) {
      closeModal();
    }
  });

  // ---- Sortable + filterable DataTable ------------------------------
  const sortTable = document.getElementById("sort-table");
  const tableFilter = document.getElementById("table-filter");
  const tableFooter = document.getElementById("table-footer");
  let sortState = { col: null, dir: "asc" };
  function getRows() {
    return Array.from(sortTable.querySelectorAll("tbody tr"));
  }
  function applyFilter() {
    if (!tableFilter || !tableFooter) return;
    const needle = tableFilter.value.toLowerCase();
    const rows = getRows();
    let visible = 0;
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      const matches = !needle || text.includes(needle);
      row.style.display = matches ? "" : "none";
      if (matches) visible++;
    });
    tableFooter.textContent =
      `${visible} row${visible === 1 ? "" : "s"}` +
      (needle ? ` (filtered from ${rows.length})` : "");
  }
  function applySort(col, isNumeric) {
    if (!sortTable) return;
    const tbody = sortTable.querySelector("tbody");
    const rows = getRows();
    rows.sort((a, b) => {
      let va = a.children[col].textContent.trim();
      let vb = b.children[col].textContent.trim();
      if (isNumeric) {
        va = parseFloat(va);
        vb = parseFloat(vb);
      }
      if (va < vb) return sortState.dir === "asc" ? -1 : 1;
      if (va > vb) return sortState.dir === "asc" ? 1 : -1;
      return 0;
    });
    rows.forEach((r) => tbody.appendChild(r));
    sortTable.querySelectorAll("th.sortable").forEach((th) => {
      const c = parseInt(th.dataset.col, 10);
      const cleaned = th.textContent.replace(/[▲▼\s]+$/, "");
      th.textContent =
        cleaned + (c === col ? (sortState.dir === "asc" ? " ▲" : " ▼") : "");
    });
  }
  if (sortTable) {
    sortTable.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = parseInt(th.dataset.col, 10);
        const isNumeric = th.hasAttribute("data-numeric");
        if (sortState.col === col) {
          sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        } else {
          sortState = { col, dir: "asc" };
        }
        applySort(col, isNumeric);
      });
    });
  }
  if (tableFilter) {
    tableFilter.addEventListener("input", applyFilter);
    tableFilter.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        tableFilter.value = "";
        applyFilter();
      }
    });
  }

  // ---- Copy URL with caveat ------------------------------------------
  const copyBtn = document.getElementById("copy-url-btn");
  const copyFeedback = document.getElementById("copy-feedback");
  if (copyBtn && copyFeedback) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        copyFeedback.textContent = "Copied — but only works on this machine.";
        setTimeout(() => (copyFeedback.textContent = ""), 3000);
      } catch (err) {
        copyFeedback.textContent =
          "Clipboard blocked — copy manually: " + location.href;
      }
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
