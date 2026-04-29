"""Minimal Jira auth probe used by /setup. Full client is in client.py (step 1.4)."""

from __future__ import annotations

import httpx


class JiraAuthError(Exception):
    """Raised when Jira credentials fail validation."""


async def probe_jira_credentials(
    base_url: str, email: str, api_token: str, *, timeout_s: float = 10.0
) -> dict:
    """Hit `/rest/api/3/myself` to validate creds. Returns the response payload on success.

    Raises JiraAuthError on any failure, including 4xx and network errors.
    """
    if not email or not api_token:
        raise JiraAuthError("email and api_token are required")

    url = f"{base_url.rstrip('/')}/rest/api/3/myself"
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(
                url,
                auth=(email, api_token),
                headers={"Accept": "application/json"},
            )
    except httpx.TimeoutException as e:
        raise JiraAuthError(f"Jira request timed out after {timeout_s}s") from e
    except httpx.RequestError as e:
        raise JiraAuthError(f"Network error reaching Jira: {e}") from e

    if response.status_code == 401:
        raise JiraAuthError("Jira returned 401 — email or token rejected")
    if response.status_code == 403:
        raise JiraAuthError("Jira returned 403 — credentials valid but lack access")
    if response.status_code >= 400:
        raise JiraAuthError(
            f"Jira returned {response.status_code}: {response.text[:200]}"
        )

    return response.json()
