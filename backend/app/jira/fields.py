"""Custom-field registry — IDs locked from spike, with discovery as a safety net.

The team's tenant uses these custom field IDs (verified 2026-04-30):
- Story Points: customfield_10901
- Sprint:       customfield_10007
- Team:         customfield_10500

Discovery is best-effort: if `/rest/api/3/field` succeeds and returns a field
named "Story Points" or "Sprint" with a different ID, we update the registry.
If discovery fails (network, auth, rate-limit), we keep the locked defaults
and the system continues to work.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class FieldIds:
    story_points: str
    sprint: str
    team: str


DEFAULT_FIELD_IDS = FieldIds(
    story_points="customfield_10901",
    sprint="customfield_10007",
    team="customfield_10500",
)


class FieldRegistry:
    """Mutable holder for custom-field IDs. Threadsafe enough for single-process use."""

    def __init__(self, defaults: FieldIds = DEFAULT_FIELD_IDS):
        self.story_points = defaults.story_points
        self.sprint = defaults.sprint
        self.team = defaults.team
        self._discovered = False

    @property
    def discovered(self) -> bool:
        return self._discovered

    def core_fields(self) -> list[str]:
        """Field IDs needed on every issue payload."""
        return [
            "summary",
            "status",
            "issuetype",
            "assignee",
            "reporter",
            "parent",
            "labels",
            "resolutiondate",
            "duedate",
            "created",
            "updated",
            self.story_points,
            self.sprint,
            self.team,
        ]

    async def refresh(self, jira_client) -> None:
        """Best-effort discovery. Logs but never raises."""
        try:
            fields = await jira_client.list_fields()
        except Exception as e:
            logger.warning("field_discovery_failed_using_defaults", err=str(e))
            return

        for f in fields:
            name = (f.get("name") or "").strip().lower()
            fid = f.get("id")
            if not fid or not name:
                continue
            if name == "story points":
                if self.story_points != fid:
                    logger.info("field_discovery_override", field="story_points", was=self.story_points, now=fid)
                self.story_points = fid
            elif name == "sprint":
                if self.sprint != fid:
                    logger.info("field_discovery_override", field="sprint", was=self.sprint, now=fid)
                self.sprint = fid
            # Team field is tenant-specific — not auto-discovered by name.

        self._discovered = True
