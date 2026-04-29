"""FastAPI app entrypoint with lifespan + scheduler hookup."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.api import routes_holidays, routes_leaves, routes_setup, routes_sync
from app.config import get_settings
from app.db import dispose_engine, get_session_factory
from app.jira.fields import FieldRegistry
from app.middleware import SetupGateMiddleware
from app.sync.runner import SyncRunner
from app.sync.scheduler import build_scheduler

logger = structlog.get_logger(__name__)

# Global runtime state (set up in lifespan; accessed by routes via get_runner()).
_runner: SyncRunner | None = None


def get_runner() -> SyncRunner | None:
    return _runner


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
    global _runner
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info("startup", configured=settings.is_configured)

    scheduler = None
    if settings.is_configured:
        _runner = SyncRunner(
            settings=settings,
            session_factory=get_session_factory(),
            fields=FieldRegistry(),
        )
        scheduler = build_scheduler(settings, _runner)
        scheduler.start()

    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)
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
