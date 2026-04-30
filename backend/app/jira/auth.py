"""Minimal Jira auth probe used by /setup. Full client is in client.py (step 1.4).

Uses `/rest/api/3/field` instead of the conventional `/rest/api/3/myself`
because some Atlassian tenants (including eagleeyenetworks) restrict
`/myself` to OAuth authentication while leaving `/field` accessible via
Basic auth. The probe still confirms credentials are valid and can read
Jira; we lose `displayName` / `accountId` from the response but those
were nice-to-haves, not load-bearing.
"""

from __future__ import annotations

import httpx


class JiraAuthError(Exception):
    """Raised when Jira credentials fail validation."""


async def probe_jira_credentials(
    base_url: str, email: str, api_token: str, *, timeout_s: float = 10.0
) -> dict:
    """Validate creds. Returns a small status dict on success.

    Tries `/rest/api/3/myself` first (richer info), falls back to
    `/rest/api/3/field` if that endpoint is OAuth-restricted on this tenant.
    Raises JiraAuthError if both fail.
    """
    if not email or not api_token:
        raise JiraAuthError("email and api_token are required")

    base = base_url.rstrip("/")
    last_err: str | None = None

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        # Attempt 1: /myself — richest payload when allowed
        try:
            response = await client.get(
                f"{base}/rest/api/3/myself",
                auth=(email, api_token),
                headers={"Accept": "application/json"},
            )
            if response.status_code == 200:
                payload = response.json()
                return {
                    "verified_via": "/rest/api/3/myself",
                    "accountId": payload.get("accountId"),
                    "displayName": payload.get("displayName"),
                }
            # Capture the reason for diagnostic chaining if fallback also fails
            last_err = (
                f"/myself returned {response.status_code}: {response.text[:120]}"
            )
        except httpx.TimeoutException as e:
            raise JiraAuthError(f"Jira request timed out after {timeout_s}s") from e
        except httpx.RequestError as e:
            raise JiraAuthError(f"Network error reaching Jira: {e}") from e

        # Attempt 2: /field — usable on tenants where /myself is OAuth-only
        try:
            response = await client.get(
                f"{base}/rest/api/3/field",
                auth=(email, api_token),
                headers={"Accept": "application/json"},
            )
        except httpx.RequestError as e:
            raise JiraAuthError(f"Network error reaching Jira: {e}") from e

    if response.status_code == 401:
        raise JiraAuthError(
            "Jira returned 401 — email or token rejected. "
            "Verify the token at id.atlassian.com/manage-profile/security/api-tokens "
            f"and check the email matches its owner. (initial /myself probe: {last_err})"
        )
    if response.status_code == 403:
        raise JiraAuthError(
            "Jira returned 403 — credentials valid but lack access to /rest/api/3/field"
        )
    if response.status_code >= 400:
        raise JiraAuthError(
            f"Jira returned {response.status_code}: {response.text[:200]}"
        )

    fields = response.json()

    # Field-listing alone isn't enough — scoped API tokens can have
    # `read:jira-user` (which lets /field through) without
    # `read:jira-work`/project access. Probe project visibility too so we
    # don't silently sync zero issues.
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        try:
            project_resp = await client.get(
                f"{base}/rest/api/3/project/search",
                auth=(email, api_token),
                params={"maxResults": 1},
                headers={"Accept": "application/json"},
            )
        except httpx.RequestError as e:
            raise JiraAuthError(f"Network error reaching Jira: {e}") from e

    if project_resp.status_code == 200:
        body = project_resp.json()
        total = body.get("total", 0) if isinstance(body, dict) else 0
        if total == 0:
            raise JiraAuthError(
                "Token authenticates but has no project read access (0 visible projects). "
                "Likely a scoped API token missing `read:jira-work`. "
                "Re-create at id.atlassian.com/manage-profile/security/api-tokens "
                "as a Classic token, or include `read:jira-work` + `read:project:jira` + "
                "`read:issue:jira` scopes."
            )

    return {
        "verified_via": "/rest/api/3/field",
        "field_count": len(fields) if isinstance(fields, list) else None,
        "accountId": None,
        "displayName": None,
    }
