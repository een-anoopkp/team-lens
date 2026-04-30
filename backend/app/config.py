"""Runtime settings loaded from `.env`. See `backend/.env.example`."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    jira_email: str = ""
    jira_api_token: str = ""
    jira_base_url: str = "https://eagleeyenetworks.atlassian.net"
    jira_board_id: int = 135
    jira_team_field: str = "customfield_10500"
    jira_team_value: str = ""
    jira_sprint_field: str = "customfield_10007"
    jira_story_points_field: str = "customfield_10901"
    jira_sprint_name_prefix: str = "Search 20"

    database_url: str = "postgresql+asyncpg://teamlens:teamlens@localhost:5432/teamlens"
    alembic_database_url: str = "postgresql://teamlens:teamlens@localhost:5432/teamlens"

    # Default: incremental sync 4× daily at 07/11/15/19 IST. Once-daily was
    # too sparse — labels added at 09:00 wouldn't reflect until 07:00 next day.
    sync_cron: str = "0 7,11,15,19 * * *"
    full_scan_cron: str = "0 3 * * 0"

    log_level: str = "INFO"
    team_region: str = "IN"

    # Anthropic API key for Insights LLM rules. When unset, /insights renders
    # LLM cards in a "needs config" state and skips background runs.
    anthropic_api_key: str = ""
    # Default model for LLM rules. Overridable per rule via config.
    anthropic_model: str = "claude-sonnet-4-6"

    app_host: str = "0.0.0.0"
    app_port: int = 8000

    @property
    def is_configured(self) -> bool:
        return bool(self.jira_email and self.jira_api_token and self.jira_team_value)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    """Clear cache and reload — used after `/setup/jira` writes new values."""
    get_settings.cache_clear()
    return get_settings()
