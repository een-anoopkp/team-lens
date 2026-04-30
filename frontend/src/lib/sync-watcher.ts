/**
 * Watches `useSyncStatus()` and invalidates ALL TanStack Query caches the
 * moment a sync run flips from running → not-running. Mount once at the
 * shell level (AppShell.tsx) so any sync trigger — Refresh button, manual
 * `/sync/run`, scheduled cron — refreshes the page data system-wide.
 *
 * Spec (06-phases.md / 05-frontend.md):
 *   click → POST /sync/run → poll /sync/status at 2s while running →
 *   on completion `queryClient.invalidateQueries()` (no key) refetches
 *   everything in one shot.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSyncStatus } from "../api";

export function useSyncCompletionInvalidator(): void {
  const qc = useQueryClient();
  const { data } = useSyncStatus();
  const wasRunning = useRef<boolean>(false);

  useEffect(() => {
    if (!data) return;
    const isRunning = data.is_running;
    // Edge: running just transitioned to not-running → refetch everything.
    if (wasRunning.current && !isRunning) {
      qc.invalidateQueries();
    }
    wasRunning.current = isRunning;
  }, [data?.is_running, qc]);
}
