"""Per-run counters carried through the sync pipeline.

Populated by the workers in `sync/*.py`, written to `sync_runs` at end of run.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SyncStats:
    issues_seen: int = 0
    issues_inserted: int = 0
    issues_updated: int = 0
    issues_removed: int = 0
    sp_changes: int = 0
    assignee_changes: int = 0
    status_changes: int = 0
    error_message: str | None = None
    touched_issue_keys: set[str] = field(default_factory=set)
