"""Sync engine — pulls from Jira, writes to Postgres.

Components:
- transform.py     pure functions: Jira JSON → ORM-ready dicts + ADF text extraction
- context.py       SyncContext — persistent deps (settings/session/fields) threaded through workers
- stats.py         SyncStats — per-run counters
- runner.py        SyncRunner orchestrates full / incremental / removal-detection
- scheduler.py     APScheduler wires SYNC_CRON + FULL_SCAN_CRON into the lifespan
- snapshots.py     (step 1.6) snapshot diff — invoked by runner as a hook
- projects.py      (step 1.7) project freeze job — invoked by runner as a hook
"""
