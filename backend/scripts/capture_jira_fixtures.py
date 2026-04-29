"""Capture real Jira API responses for use as test fixtures.

Run this ONCE against the live tenant to seed `backend/tests/fixtures/jira/`.
Re-run only when the Jira API contract changes. Output JSON is committed.

Usage:
    cd backend && uv run python -m scripts.capture_jira_fixtures

All requests are READ-ONLY (GET).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.config import get_settings
from app.jira.client import JiraClient

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "jira"

# AccountIDs are scrubbed to predictable test IDs to avoid leaking real identities.
_ACCOUNT_ID_REMAP: dict[str, str] = {}


def _scrub_account_id(real: str) -> str:
    if real not in _ACCOUNT_ID_REMAP:
        _ACCOUNT_ID_REMAP[real] = f"test-account-{len(_ACCOUNT_ID_REMAP) + 1:03d}"
    return _ACCOUNT_ID_REMAP[real]


def _scrub(obj):
    """Recursively replace accountId values + emails."""
    if isinstance(obj, dict):
        scrubbed = {}
        for k, v in obj.items():
            if k == "accountId" and isinstance(v, str):
                scrubbed[k] = _scrub_account_id(v)
            elif k in ("emailAddress", "email") and isinstance(v, str):
                scrubbed[k] = "redacted@example.com"
            elif k == "avatarUrls" and isinstance(v, dict):
                scrubbed[k] = {"48x48": "https://example.invalid/avatar.png"}
            else:
                scrubbed[k] = _scrub(v)
        return scrubbed
    if isinstance(obj, list):
        return [_scrub(x) for x in obj]
    return obj


def _write(name: str, data) -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    path = FIXTURES_DIR / name
    path.write_text(json.dumps(_scrub(data), indent=2, ensure_ascii=False) + "\n")
    print(f"  wrote {path.relative_to(FIXTURES_DIR.parent.parent.parent)}")


async def main() -> None:
    s = get_settings()
    if not s.is_configured:
        raise SystemExit("Run /api/v1/setup/jira first or fill backend/.env")

    print(f"Capturing fixtures from {s.jira_base_url} ...")
    async with JiraClient(s.jira_base_url, s.jira_email, s.jira_api_token) as jira:
        # myself
        _write("myself.json", await jira.myself())

        # field listing
        _write("fields.json", await jira.list_fields())

        # board sprints (active)
        sprints_active: list[dict] = []
        async for sp in await jira.list_board_sprints(s.jira_board_id, state="active"):
            sprints_active.append(sp)
        _write("board_sprints_active.json", {"values": sprints_active})

        # board sprints (closed) — limit to 5 most recent
        sprints_closed: list[dict] = []
        async for sp in await jira.list_board_sprints(s.jira_board_id, state="closed"):
            sprints_closed.append(sp)
            if len(sprints_closed) >= 5:
                break
        _write("board_sprints_closed.json", {"values": sprints_closed})

        # one sample sprint detail
        if sprints_closed:
            _write("sprint_detail.json", await jira.get_sprint(sprints_closed[0]["id"]))

        # search/jql — small page from the most-recent closed sprint
        if sprints_closed:
            sample = []
            async for issue in await jira.search_issues(
                f'sprint = {sprints_closed[0]["id"]}', page_size=5
            ):
                sample.append(issue)
                if len(sample) >= 3:
                    break
            _write("search_jql_page.json", {"issues": sample, "isLast": True})

            # sample issue detail + comments
            if sample:
                key = sample[0]["key"]
                _write(f"issue_{key}.json", await jira.get_issue(key))
                cs = []
                async for c in await jira.list_issue_comments(key):
                    cs.append(c)
                    if len(cs) >= 3:
                        break
                _write(f"issue_{key}_comments.json", {"comments": cs, "total": len(cs)})

    print("\nFixture capture complete.")
    print(f"  account-id remaps: {len(_ACCOUNT_ID_REMAP)} (saved into the JSON files)")


if __name__ == "__main__":
    asyncio.run(main())
