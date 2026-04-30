"""Phase 3 metrics — pure SQL aggregations on top of synced data.

Each module exports a single async function that takes a session and
returns a typed dict / list. The route layer (app/api/routes_metrics.py)
wraps these with FastAPI + Pydantic response models.

No Jira calls; no schema changes — just queries.
"""
