"""Tests for the first-run setup flow.

Verifies:
- /setup/test validates creds via /rest/api/3/myself without persisting
- /setup/jira persists on success and reloads settings in-process
- The setup gate blocks data routes until configured
- Atomic env_writer preserves untouched lines and replaces target keys
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
import respx

from app.setup.env_writer import update_env_file


# ---------- env_writer ---------------------------------------------------------

def test_env_writer_replaces_existing_key(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("FOO=old\nBAR=keep\n")
    update_env_file(env, {"FOO": "new"})
    contents = env.read_text()
    assert "FOO=new" in contents
    assert "BAR=keep" in contents
    assert "FOO=old" not in contents


def test_env_writer_appends_new_key(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("EXISTING=1\n")
    update_env_file(env, {"NEWKEY": "value"})
    contents = env.read_text()
    assert "EXISTING=1" in contents
    assert "NEWKEY=value" in contents


def test_env_writer_creates_file(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    update_env_file(env, {"FOO": "bar"})
    assert env.read_text().strip() == "FOO=bar"


def test_env_writer_preserves_comments_and_blank_lines(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("# header comment\n\nFOO=old\n\n# trailing\n")
    update_env_file(env, {"FOO": "new"})
    contents = env.read_text()
    assert "# header comment" in contents
    assert "# trailing" in contents
    assert "FOO=new" in contents


def test_env_writer_handles_export_prefix(tmp_path: Path) -> None:
    """Lines like `export FOO=bar` should also be replaceable."""
    env = tmp_path / ".env"
    env.write_text("export FOO=old\nBAR=keep\n")
    update_env_file(env, {"FOO": "new"})
    contents = env.read_text()
    assert "FOO=new" in contents
    assert "BAR=keep" in contents


# ---------- /setup/test --------------------------------------------------------

@pytest.mark.asyncio
async def test_setup_test_endpoint_success(app_client) -> None:
    with respx.mock(base_url="https://eagleeyenetworks.atlassian.net") as mock:
        mock.get("/rest/api/3/myself").respond(
            200, json={"accountId": "abc123", "displayName": "Test User"}
        )
        response = await app_client.post(
            "/api/v1/setup/test",
            json={"email": "test@example.com", "api_token": "valid-token"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["account_id"] == "abc123"
    assert body["display_name"] == "Test User"


@pytest.mark.asyncio
async def test_setup_test_endpoint_unauthorized(app_client) -> None:
    """Both /myself and the /field fallback reject — surface as 401 to the caller."""
    with respx.mock(base_url="https://eagleeyenetworks.atlassian.net") as mock:
        mock.get("/rest/api/3/myself").respond(401, json={"error": "Unauthorized"})
        mock.get("/rest/api/3/field").respond(401, json={"error": "Unauthorized"})
        response = await app_client.post(
            "/api/v1/setup/test",
            json={"email": "test@example.com", "api_token": "bad-token"},
        )
    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "jira_unauthorized"


@pytest.mark.asyncio
async def test_setup_test_falls_back_to_field_when_myself_is_oauth_only(
    app_client,
) -> None:
    """Some tenants (eagleeyenetworks, observed 2026-04-30) restrict /myself
    to OAuth while leaving /field accessible via Basic auth. Verify the probe
    succeeds via the fallback path."""
    with respx.mock(base_url="https://eagleeyenetworks.atlassian.net") as mock:
        mock.get("/rest/api/3/myself").respond(401, json={"error": "Unauthorized"})
        mock.get("/rest/api/3/field").respond(
            200, json=[{"id": "customfield_10901", "name": "Story Points"}]
        )
        # After /field succeeds, the probe also hits /project/search to detect
        # scoped tokens that pass /field but have no project read access.
        mock.get("/rest/api/3/project/search").respond(
            200, json={"total": 1, "values": [{"id": "10000", "key": "EEPD"}]}
        )
        response = await app_client.post(
            "/api/v1/setup/test",
            json={"email": "test@example.com", "api_token": "valid-token"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert "/rest/api/3/field" in body["message"]


@pytest.mark.asyncio
async def test_setup_test_endpoint_validates_payload(app_client) -> None:
    """Bad email + missing token → 422 validation."""
    response = await app_client.post(
        "/api/v1/setup/test",
        json={"email": "not-an-email", "api_token": ""},
    )
    assert response.status_code == 422


# ---------- /setup/jira (persists) --------------------------------------------

@pytest.mark.asyncio
async def test_setup_jira_persists(app_client, monkeypatch, tmp_path: Path) -> None:
    """Successful setup writes to .env and reloads settings."""
    env_file = tmp_path / ".env"
    env_file.write_text("EXISTING_KEY=preserve\n")

    # Redirect both the env-writer and config loader at the temp file
    import app.api.routes_setup as routes_setup
    import app.config as config_module

    monkeypatch.setattr(routes_setup, "ENV_PATH", env_file)
    monkeypatch.setattr(config_module, "ENV_PATH", env_file)

    with respx.mock(base_url="https://eagleeyenetworks.atlassian.net") as mock:
        mock.get("/rest/api/3/myself").respond(
            200, json={"accountId": "abc123", "displayName": "Test"}
        )
        response = await app_client.post(
            "/api/v1/setup/jira",
            json={"email": "real@example.com", "api_token": "real-token"},
        )

    assert response.status_code == 200
    contents = env_file.read_text()
    assert "JIRA_EMAIL=real@example.com" in contents
    assert "JIRA_API_TOKEN=real-token" in contents
    assert "EXISTING_KEY=preserve" in contents


# ---------- setup gate middleware ---------------------------------------------

@pytest.mark.asyncio
async def test_health_endpoint_is_always_open(app_client) -> None:
    response = await app_client.get("/api/v1/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_data_routes_blocked_before_configuration(monkeypatch) -> None:
    """A data route should 503 when JIRA_EMAIL is empty (unconfigured)."""
    from asgi_lifespan import LifespanManager
    from httpx import ASGITransport, AsyncClient

    # Override settings to look unconfigured
    import app.config as config_module
    config_module.get_settings.cache_clear()
    monkeypatch.setattr(config_module.Settings, "is_configured", property(lambda self: False))

    from app.main import create_app

    app = create_app()

    @app.get("/api/v1/dummy")
    async def dummy() -> dict:
        return {"ok": True}

    async with LifespanManager(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/api/v1/dummy")

    assert response.status_code == 503
    assert response.json()["error"] == "setup_required"
