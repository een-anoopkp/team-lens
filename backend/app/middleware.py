"""Setup-required middleware — gates data routes until Jira creds are present."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings

# Paths that remain accessible before configuration is complete.
_ALWAYS_OPEN_PREFIXES: tuple[str, ...] = (
    "/api/v1/health",
    "/api/v1/setup/",
    "/docs",
    "/openapi.json",
    "/redoc",
)


class SetupGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Always-allowed paths
        for prefix in _ALWAYS_OPEN_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # Non-API requests pass through (e.g., 404 on stray paths handled by FastAPI)
        if not path.startswith("/api/"):
            return await call_next(request)

        # Gate everything else behind setup
        if not get_settings().is_configured:
            return JSONResponse(
                status_code=503,
                content={
                    "error": "setup_required",
                    "message": "Jira credentials not configured. POST to /api/v1/setup/jira first.",
                },
            )
        return await call_next(request)
