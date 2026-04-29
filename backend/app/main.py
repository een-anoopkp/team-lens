"""FastAPI app entrypoint with lifespan + scheduler hookup."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.config import get_settings
from app.db import dispose_engine

logger = structlog.get_logger(__name__)


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
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info("startup", configured=settings.is_configured)
    # Scheduler is wired in step 1.5 (sync engine); placeholder here.
    try:
        yield
    finally:
        await dispose_engine()
        logger.info("shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Team-Lens API",
        version="0.1.0",
        description="Local backend for the Search team's Jira dashboard.",
        lifespan=lifespan,
    )

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
