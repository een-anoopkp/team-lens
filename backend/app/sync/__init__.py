"""Sync engine — pulls from Jira, writes to Postgres.

Components:
- transform.py     pure functions: Jira JSON → ORM-ready dicts + ADF text extraction
- context.py       SyncContext — persistent deps (settings/session/fields) threaded through workers
- stats.py         SyncStats — per-run counters
- runner.py        SyncRunner orchestrates the pipeline + run lifecycle
- sprints.py       board sprint pull + upsert (also reused by issues.py for embedded sprints)
- people.py        person upsert — shared by issue + comment paths
- issues.py        issue search loop, parent walk, and per-batch upsert pipeline
- comments.py      concurrent comment fetch + bulk upsert
- snapshots.py     snapshot diff — invoked by runner as a hook
- projects.py      project freeze job — invoked by runner as a hook
- scheduler.py     APScheduler wires SYNC_CRON + FULL_SCAN_CRON into the lifespan
"""
