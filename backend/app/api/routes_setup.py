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
        message="Jira credentials valid.",
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
    logger.info(
        "jira_setup_success",
        account_id=myself.get("accountId"),
        configured=new_settings.is_configured,
    )

    return TestConnectionResponse(
        ok=True,
        account_id=myself.get("accountId"),
        display_name=myself.get("displayName"),
        message="Configuration saved.",
    )
