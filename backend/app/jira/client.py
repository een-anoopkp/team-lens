"""Async Jira REST client.

Read-only by design for Phase 1. Mutations (comments, transitions) come in v2/v3.
Patterns ported from `apps-script/sprint-health/JiraClient.gs:97-119` (auth,
paginate, 429/503 retry honouring Retry-After).

Pagination uses `/rest/api/3/search/jql` with `nextPageToken` (the modern
endpoint; the legacy `/rest/api/3/search` with `startAt`/`maxResults` is
deprecated and capped at 5,000 issues).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

# Status codes worth retrying — transient on Atlassian's side.
_RETRIABLE_STATUS = frozenset({429, 502, 503, 504})


class JiraClientError(Exception):
    """Non-retriable failure from the Jira API."""


class JiraClient:
    """Thin async wrapper around Jira Cloud REST + Agile APIs.

    Use as an async context manager:

        async with JiraClient(base, email, token) as jira:
            me = await jira.myself()
    """

    def __init__(
        self,
        base_url: str,
        email: str,
        api_token: str,
        *,
        timeout_s: float = 30.0,
        max_retries: int = 5,
        max_backoff_s: float = 30.0,
    ):
        if not email or not api_token:
            raise ValueError("email and api_token must be set")
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            auth=(email, api_token),
            timeout=httpx.Timeout(timeout_s, connect=10.0),
            headers={"Accept": "application/json"},
        )
        self._max_retries = max_retries
        self._max_backoff_s = max_backoff_s

    async def __aenter__(self) -> JiraClient:
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ---- Core request loop --------------------------------------------------

    async def _request(
        self, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        delay = 1.0
        last_response: httpx.Response | None = None

        for attempt in range(self._max_retries):
            try:
                response = await self._client.request(method, path, **kwargs)
            except httpx.TimeoutException as e:
                if attempt == self._max_retries - 1:
                    raise JiraClientError(f"Timeout after {attempt + 1} attempts") from e
                logger.warning("jira_timeout", path=path, attempt=attempt)
                await asyncio.sleep(delay)
                delay = min(delay * 2, self._max_backoff_s)
                continue
            except httpx.RequestError as e:
                if attempt == self._max_retries - 1:
                    raise JiraClientError(f"Network error: {e}") from e
                logger.warning("jira_network_error", path=path, attempt=attempt, err=str(e))
                await asyncio.sleep(delay)
                delay = min(delay * 2, self._max_backoff_s)
                continue

            if response.status_code in _RETRIABLE_STATUS:
                last_response = response
                wait_s = self._compute_backoff(response, default=delay)
                if attempt == self._max_retries - 1:
                    break
                logger.warning(
                    "jira_retriable_status",
                    status=response.status_code,
                    path=path,
                    wait_s=wait_s,
                    attempt=attempt,
                )
                await asyncio.sleep(wait_s)
                delay = min(delay * 2, self._max_backoff_s)
                continue

            return response

        # Exhausted retries — surface the last retriable response
        if last_response is not None:
            raise JiraClientError(
                f"Jira returned {last_response.status_code} after "
                f"{self._max_retries} attempts: {last_response.text[:200]}"
            )
        raise JiraClientError("Jira request loop exited without response")

    @staticmethod
    def _compute_backoff(response: httpx.Response, *, default: float) -> float:
        """Honour Retry-After (seconds or HTTP-date) when present."""
        retry_after = response.headers.get("Retry-After", "")
        if retry_after.isdigit():
            return float(retry_after)
        return default

    async def _get_json(self, path: str, **params: Any) -> Any:
        response = await self._request("GET", path, params=params or None)
        if response.status_code >= 400:
            raise JiraClientError(
                f"Jira returned {response.status_code} for GET {path}: {response.text[:200]}"
            )
        return response.json()

    # ---- High-level helpers ------------------------------------------------

    async def myself(self) -> dict:
        return await self._get_json("/rest/api/3/myself")

    async def list_fields(self) -> list[dict]:
        return await self._get_json("/rest/api/3/field")

    async def get_issue(
        self, issue_key: str, *, fields: list[str] | None = None, expand: str | None = None
    ) -> dict:
        params: dict[str, Any] = {}
        if fields is not None:
            params["fields"] = ",".join(fields)
        if expand:
            params["expand"] = expand
        return await self._get_json(f"/rest/api/3/issue/{issue_key}", **params)

    async def search_issues(
        self,
        jql: str,
        *,
        fields: list[str] | None = None,
        page_size: int = 100,
    ) -> AsyncIterator[dict]:
        """Paginated issue search via the modern /search/jql endpoint.

        Yields one issue dict per item. The endpoint returns up to `maxResults`
        per page and a `nextPageToken` for the next page.
        """
        return self._search_issues_iter(jql, fields=fields, page_size=page_size)

    async def _search_issues_iter(
        self,
        jql: str,
        *,
        fields: list[str] | None,
        page_size: int,
    ) -> AsyncIterator[dict]:
        next_token: str | None = None
        page = 0
        while True:
            params: dict[str, Any] = {
                "jql": jql,
                "maxResults": page_size,
            }
            if fields is not None:
                params["fields"] = ",".join(fields)
            if next_token is not None:
                params["nextPageToken"] = next_token

            payload = await self._get_json("/rest/api/3/search/jql", **params)
            issues: list[dict] = payload.get("issues", []) or []
            for issue in issues:
                yield issue

            page += 1
            logger.debug("jira_search_page", page=page, count=len(issues), jql=jql[:80])

            if payload.get("isLast"):
                return
            next_token = payload.get("nextPageToken")
            if not next_token:
                return

    async def list_issue_comments(
        self, issue_key: str, *, page_size: int = 100
    ) -> AsyncIterator[dict]:
        """Paginated comments on a single issue."""
        return self._list_issue_comments_iter(issue_key, page_size=page_size)

    async def _list_issue_comments_iter(
        self, issue_key: str, *, page_size: int
    ) -> AsyncIterator[dict]:
        start_at = 0
        while True:
            payload = await self._get_json(
                f"/rest/api/3/issue/{issue_key}/comment",
                startAt=start_at,
                maxResults=page_size,
            )
            comments: list[dict] = payload.get("comments", []) or []
            for c in comments:
                yield c

            total = payload.get("total")
            start_at += len(comments)
            if total is None or start_at >= total or not comments:
                return

    async def list_board_sprints(
        self,
        board_id: int,
        *,
        state: str | None = None,
        page_size: int = 50,
    ) -> AsyncIterator[dict]:
        return self._list_board_sprints_iter(board_id, state=state, page_size=page_size)

    async def _list_board_sprints_iter(
        self, board_id: int, *, state: str | None, page_size: int
    ) -> AsyncIterator[dict]:
        start_at = 0
        while True:
            params: dict[str, Any] = {"startAt": start_at, "maxResults": page_size}
            if state:
                params["state"] = state
            payload = await self._get_json(
                f"/rest/agile/1.0/board/{board_id}/sprint", **params
            )
            sprints: list[dict] = payload.get("values", []) or []
            for s in sprints:
                yield s

            if payload.get("isLast", True):
                return
            start_at += len(sprints)
            if not sprints:
                return

    async def get_sprint(self, sprint_id: int) -> dict:
        return await self._get_json(f"/rest/agile/1.0/sprint/{sprint_id}")
