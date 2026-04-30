"""FastAPI app entrypoint with lifespan + scheduler hookup."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI

from app.api import (
    routes_epics,
    routes_holidays,
    routes_hygiene,
    routes_issues,
    routes_leaderboard,
    routes_leaves,
    routes_metrics,
    routes_people,
    routes_projects,
    routes_setup,
    routes_sprints,
    routes_sync,
)
from app.config import get_settings
from app.db import dispose_engine, get_session_factory
from app.jira.fields import FieldRegistry
from app.middleware import SetupGateMiddleware
from app.sync.runner import SyncRunner
from app.sync.scheduler import build_scheduler

logger = structlog.get_logger(__name__)

# Global runtime state. Lazy-initialised — the runner doesn't exist until
# either the lifespan or get_runner() finds is_configured == True.
_runner: SyncRunner | None = None
_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler | None:
    """Returns the running scheduler, or None if it hasn't been started yet."""
    return _scheduler


def get_runner() -> SyncRunner | None:
    """Return the runner; lazy-init it (and the scheduler) if creds are present.

    This keeps the no-restart-after-setup UX working: when /setup/jira writes
    the .env and reload_settings() flips is_configured to True, the very next
    /sync/run lazily spins up the runner + scheduler.
    """
    global _runner, _scheduler
    if _runner is None:
        settings = get_settings()
        if settings.is_configured:
            _runner = SyncRunner(
                settings=settings,
                session_factory=get_session_factory(),
                fields=FieldRegistry(),
            )
            try:
                _scheduler = build_scheduler(settings, _runner)
                _scheduler.start()
                logger.info("runner_lazy_initialised_with_scheduler")
            except Exception:
                logger.exception("scheduler_lazy_start_failed")
                # Runner is still useful for manual /sync/run even without scheduler.
    return _runner


def reset_runner() -> None:
    """Tear down the cached runner + scheduler so the next get_runner() rebuilds.

    Called by /setup/jira after writing new credentials — the existing runner
    captured settings at construction time and won't pick up the new token
    otherwise.
    """
    global _runner, _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            logger.exception("scheduler_shutdown_failed_during_reset")
        _scheduler = None
    _runner = None
    logger.info("runner_reset")


def configure_logging(level: str) -> None:
    logging.basicConfig(level=level.upper())
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(level.upper())
        ),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _runner, _scheduler
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info("startup", configured=settings.is_configured)

    if settings.is_configured:
        # Eager init when creds are already present at startup.
        _runner = SyncRunner(
            settings=settings,
            session_factory=get_session_factory(),
            fields=FieldRegistry(),
        )
        _scheduler = build_scheduler(settings, _runner)
        _scheduler.start()

    try:
        yield
    finally:
        if _scheduler is not None:
            _scheduler.shutdown(wait=False)
            _scheduler = None
        await dispose_engine()
        _runner = None
        logger.info("shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Team-Lens API",
        version="0.1.0",
        description="Local backend for the Search team's Jira dashboard.",
        lifespan=lifespan,
    )

    app.add_middleware(SetupGateMiddleware)
    app.include_router(routes_setup.router)
    app.include_router(routes_sync.router)
    app.include_router(routes_leaves.router)
    app.include_router(routes_holidays.router)
    app.include_router(routes_sprints.router)
    app.include_router(routes_issues.router)
    app.include_router(routes_epics.router)
    app.include_router(routes_people.router)
    app.include_router(routes_projects.router)
    app.include_router(routes_metrics.router)
    app.include_router(routes_hygiene.router)
    app.include_router(routes_leaderboard.router)

    @app.get("/api/v1/health")
    async def health() -> dict:
        s = get_settings()
        return {
            "status": "ok",
            "configured": s.is_configured,
            "jira": "configured" if s.is_configured else "unconfigured",
            "version": app.version,
        }

    return app


app = create_app()
