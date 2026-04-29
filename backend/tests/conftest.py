"""Pytest fixtures shared across the backend test suite."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

# Ensure tests never accidentally hit the real Jira tenant.
os.environ.setdefault("JIRA_EMAIL", "test@example.com")
os.environ.setdefault("JIRA_API_TOKEN", "test-token")
os.environ.setdefault("JIRA_TEAM_VALUE", "test-team-uuid")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://teamlens:teamlens@localhost:5432/teamlens_test")


@pytest.fixture
async def app_client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    app = create_app()
    async with LifespanManager(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            yield client
