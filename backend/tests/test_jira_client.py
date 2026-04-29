"""Tests for the Jira client + field registry + payload parsers.

All tests use respx to mock HTTPS calls. No real Jira tenant is contacted.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from app.jira.client import JiraClient, JiraClientError
from app.jira.fields import DEFAULT_FIELD_IDS, FieldRegistry
from app.jira.parsers import parse_iso_datetime, parse_sprint_field

BASE = "https://eagleeyenetworks.atlassian.net"


# ---------- core request loop -------------------------------------------------

@pytest.mark.asyncio
async def test_myself_success() -> None:
    async with JiraClient(BASE, "u@x", "tok") as jira, respx.mock(base_url=BASE) as mock:
        mock.get("/rest/api/3/myself").respond(
            200, json={"accountId": "abc", "displayName": "Test"}
        )
        result = await jira.myself()
    assert result["accountId"] == "abc"


@pytest.mark.asyncio
async def test_retries_on_429_then_succeeds() -> None:
    async with JiraClient(BASE, "u@x", "tok", max_retries=3) as jira, respx.mock(base_url=BASE) as mock:
        route = mock.get("/rest/api/3/myself")
        route.side_effect = [
            httpx.Response(429, headers={"Retry-After": "0"}),
            httpx.Response(200, json={"accountId": "ok"}),
        ]
        result = await jira.myself()
    assert result["accountId"] == "ok"
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_retries_on_503_then_succeeds() -> None:
    async with JiraClient(BASE, "u@x", "tok", max_retries=3) as jira, respx.mock(base_url=BASE) as mock:
        route = mock.get("/rest/api/3/field")
        route.side_effect = [
            httpx.Response(503),
            httpx.Response(200, json=[{"id": "customfield_10901", "name": "Story Points"}]),
        ]
        fields = await jira.list_fields()
    assert fields[0]["id"] == "customfield_10901"
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_exhausts_retries_and_raises() -> None:
    async with JiraClient(BASE, "u@x", "tok", max_retries=2) as jira, respx.mock(base_url=BASE) as mock:
        mock.get("/rest/api/3/myself").mock(
            return_value=httpx.Response(429, headers={"Retry-After": "0"})
        )
        with pytest.raises(JiraClientError, match="429"):
            await jira.myself()


@pytest.mark.asyncio
async def test_4xx_raises_immediately() -> None:
    async with JiraClient(BASE, "u@x", "tok") as jira, respx.mock(base_url=BASE) as mock:
        mock.get("/rest/api/3/myself").respond(401, text="unauthorized")
        with pytest.raises(JiraClientError, match="401"):
            await jira.myself()


# ---------- pagination --------------------------------------------------------

@pytest.mark.asyncio
async def test_search_issues_paginates_via_next_page_token() -> None:
    async with JiraClient(BASE, "u@x", "tok") as jira, respx.mock(base_url=BASE) as mock:
        # Page 1: 2 issues + token; Page 2: 1 issue + isLast
        mock.get("/rest/api/3/search/jql").mock(
            side_effect=[
                httpx.Response(
                    200,
                    json={
                        "issues": [{"key": "X-1"}, {"key": "X-2"}],
                        "nextPageToken": "page2",
                        "isLast": False,
                    },
                ),
                httpx.Response(
                    200,
                    json={"issues": [{"key": "X-3"}], "isLast": True},
                ),
            ]
        )
        keys: list[str] = []
        async for issue in await jira.search_issues("sprint = 18279", page_size=2):
            keys.append(issue["key"])
    assert keys == ["X-1", "X-2", "X-3"]


@pytest.mark.asyncio
async def test_search_issues_stops_when_no_more_pages() -> None:
    async with JiraClient(BASE, "u@x", "tok") as jira, respx.mock(base_url=BASE) as mock:
        mock.get("/rest/api/3/search/jql").respond(
            200, json={"issues": [{"key": "A"}], "isLast": True}
        )
        keys = [issue["key"] async for issue in await jira.search_issues("project = X")]
    assert keys == ["A"]


@pytest.mark.asyncio
async def test_list_issue_comments_paginates_via_startAt() -> None:
    async with JiraClient(BASE, "u@x", "tok") as jira, respx.mock(base_url=BASE) as mock:
        mock.get("/rest/api/3/issue/X-1/comment").mock(
            side_effect=[
                httpx.Response(
                    200, json={"comments": [{"id": "1"}, {"id": "2"}], "total": 3}
                ),
                httpx.Response(200, json={"comments": [{"id": "3"}], "total": 3}),
            ]
        )
        ids = [c["id"] async for c in await jira.list_issue_comments("X-1")]
    assert ids == ["1", "2", "3"]


# ---------- field registry ----------------------------------------------------

def test_field_registry_defaults_match_spike() -> None:
    reg = FieldRegistry()
    assert reg.story_points == DEFAULT_FIELD_IDS.story_points == "customfield_10901"
    assert reg.sprint == DEFAULT_FIELD_IDS.sprint == "customfield_10007"
    assert reg.team == DEFAULT_FIELD_IDS.team == "customfield_10500"


@pytest.mark.asyncio
async def test_field_registry_refreshes_from_discovery() -> None:
    reg = FieldRegistry()
    async with JiraClient(BASE, "u@x", "tok") as jira, respx.mock(base_url=BASE) as mock:
        mock.get("/rest/api/3/field").respond(
            200,
            json=[
                {"id": "customfield_99001", "name": "Story Points"},
                {"id": "customfield_99002", "name": "Sprint"},
                {"id": "customfield_99003", "name": "Other"},
            ],
        )
        await reg.refresh(jira)
    assert reg.story_points == "customfield_99001"
    assert reg.sprint == "customfield_99002"
    # Team is tenant-specific; not auto-discovered.
    assert reg.team == "customfield_10500"
    assert reg.discovered is True


@pytest.mark.asyncio
async def test_field_registry_keeps_defaults_on_discovery_failure() -> None:
    reg = FieldRegistry()
    async with JiraClient(BASE, "u@x", "tok", max_retries=1) as jira, respx.mock(base_url=BASE) as mock:
        mock.get("/rest/api/3/field").respond(503)
        await reg.refresh(jira)  # must NOT raise
    assert reg.story_points == "customfield_10901"
    assert reg.discovered is False


# ---------- parsers -----------------------------------------------------------

def test_parse_sprint_field_modern_object_array() -> None:
    raw = [
        {
            "id": 18279,
            "name": "Search 2026-08",
            "state": "closed",
            "startDate": "2026-04-16T14:37:51.111Z",
            "endDate": "2026-04-29T09:30:00.000Z",
            "completeDate": "2026-04-29T11:13:21.412Z",
            "boardId": 135,
        }
    ]
    parsed = parse_sprint_field(raw)
    assert parsed == raw  # passthrough


def test_parse_sprint_field_legacy_string() -> None:
    raw = [
        "com.atlassian.greenhopper.service.sprint.Sprint@hash["
        "id=18279,name=Search 2026-08,state=closed,boardId=135]"
    ]
    parsed = parse_sprint_field(raw)
    assert parsed == [
        {
            "id": 18279,
            "name": "Search 2026-08",
            "state": "closed",
            "startDate": None,
            "endDate": None,
            "completeDate": None,
            "boardId": 135,
        }
    ]


def test_parse_sprint_field_handles_none_and_empty() -> None:
    assert parse_sprint_field(None) == []
    assert parse_sprint_field([]) == []
    assert parse_sprint_field("not a list") == []


def test_parse_iso_datetime() -> None:
    assert parse_iso_datetime("2026-04-29T11:13:21.412Z").isoformat().startswith("2026-04-29T11:13:21")
    assert parse_iso_datetime("2026-04-29T05:57:18.328-0500") is not None
    assert parse_iso_datetime(None) is None
    assert parse_iso_datetime("") is None
    assert parse_iso_datetime("not-a-date") is None
