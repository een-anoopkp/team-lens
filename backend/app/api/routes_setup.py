"""Setup endpoints — usable before Jira credentials are configured."""

from __future__ import annotations

from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.config import ENV_PATH, get_settings, reload_settings
from app.jira.auth import JiraAuthError, probe_jira_credentials
from app.setup.env_writer import update_env_file

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/setup", tags=["setup"])


class JiraSetupPayload(BaseModel):
    email: EmailStr
    api_token: str = Field(min_length=1)
    base_url: str | None = None  # optional override; defaults to current setting


class TestConnectionResponse(BaseModel):
    ok: bool
    account_id: str | None = None
    display_name: str | None = None
    message: str


class SettingsView(BaseModel):
    """Sanitised view of runtime settings — never includes the api_token."""

    configured: bool
    jira_email: str
    jira_base_url: str
    jira_board_id: int
    jira_team_field: str
    jira_team_value_masked: str  # "02623aed…2722de-28" form
    jira_sprint_name_prefix: str
    sync_cron: str
    full_scan_cron: str
    team_region: str
    api_token_last4: str  # last 4 chars only, "" when unset
    # v3 — Insights LLM:
    anthropic_configured: bool
    anthropic_key_last4: str
    anthropic_model: str


def _last4(s: str) -> str:
    return s[-4:] if len(s) >= 4 else ""


def _mask_uuid(v: str) -> str:
    if len(v) <= 12:
        return v
    return f"{v[:8]}…{v[-8:]}"


@router.get("/settings", response_model=SettingsView)
async def view_settings() -> SettingsView:
    """Read-only summary of current config for the Settings page."""
    s = get_settings()
    return SettingsView(
        configured=s.is_configured,
        jira_email=s.jira_email,
        jira_base_url=s.jira_base_url,
        jira_board_id=s.jira_board_id,
        jira_team_field=s.jira_team_field,
        jira_team_value_masked=_mask_uuid(s.jira_team_value),
        jira_sprint_name_prefix=s.jira_sprint_name_prefix,
        sync_cron=s.sync_cron,
        full_scan_cron=s.full_scan_cron,
        team_region=s.team_region,
        api_token_last4=_last4(s.jira_api_token),
        anthropic_configured=bool(s.anthropic_api_key),
        anthropic_key_last4=_last4(s.anthropic_api_key),
        anthropic_model=s.anthropic_model,
    )


@router.post("/test-current", response_model=TestConnectionResponse)
async def test_current_creds() -> TestConnectionResponse:
    """Re-test the Jira creds *currently in .env* without re-entering them."""
    s = get_settings()
    if not s.is_configured:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "setup_required",
                "message": "Jira credentials not yet configured.",
            },
        )
    try:
        myself = await probe_jira_credentials(
            s.jira_base_url, s.jira_email, s.jira_api_token
        )
    except JiraAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "jira_unauthorized", "message": str(e)},
        ) from e
    return TestConnectionResponse(
        ok=True,
        account_id=myself.get("accountId"),
        display_name=myself.get("displayName"),
        message=f"Jira credentials valid (verified via {myself.get('verified_via')}).",
    )


@router.post("/test", response_model=TestConnectionResponse)
async def test_jira_connection(payload: JiraSetupPayload) -> TestConnectionResponse:
    """Validate creds without persisting anything."""
    base_url = payload.base_url or get_settings().jira_base_url
    try:
        myself = await probe_jira_credentials(
            base_url, str(payload.email), payload.api_token
        )
    except JiraAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "jira_unauthorized", "message": str(e)},
        ) from e

    return TestConnectionResponse(
        ok=True,
        account_id=myself.get("accountId"),
        display_name=myself.get("displayName"),
        message=f"Jira credentials valid (verified via {myself.get('verified_via')}).",
    )


@router.post("/jira", response_model=TestConnectionResponse)
async def configure_jira(payload: JiraSetupPayload) -> TestConnectionResponse:
    """Validate creds, then atomically write to .env and reload settings in-process."""
    base_url = payload.base_url or get_settings().jira_base_url

    try:
        myself = await probe_jira_credentials(
            base_url, str(payload.email), payload.api_token
        )
    except JiraAuthError as e:
        logger.warning("jira_setup_failed", reason=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "jira_unauthorized", "message": str(e)},
        ) from e

    updates = {
        "JIRA_EMAIL": str(payload.email),
        "JIRA_API_TOKEN": payload.api_token,
    }
    if payload.base_url:
        updates["JIRA_BASE_URL"] = payload.base_url

    try:
        update_env_file(Path(ENV_PATH), updates)
    except OSError as e:
        logger.error("env_write_failed", reason=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "env_write_failed", "message": str(e)},
        ) from e

    new_settings = reload_settings()

    # Reset the cached runner so the next /sync/run picks up the new credentials.
    # The existing runner captured settings at construction time and would
    # otherwise keep using the previous (possibly invalid) token.
    from app.main import reset_runner

    reset_runner()

    logger.info(
        "jira_setup_success",
        account_id=myself.get("accountId"),
        verified_via=myself.get("verified_via"),
        configured=new_settings.is_configured,
    )

    return TestConnectionResponse(
        ok=True,
        account_id=myself.get("accountId"),
        display_name=myself.get("displayName"),
        message=f"Configuration saved (verified via {myself.get('verified_via')}).",
    )
