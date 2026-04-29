"""Jira payload parsers.

Handles two shapes for the Sprint custom field:
- **Modern object array** (this tenant) — list of dicts with id/name/state/startDate/endDate/...
- **Legacy GreenHopper-stringified** — list of strings like
  ``com.atlassian.greenhopper.service.sprint.Sprint@hash[id=...,name=...,state=...]``

This tenant uses the modern shape exclusively (verified 2026-04-30); the
legacy parser is kept as a defensive fallback.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

_LEGACY_SPRINT_RE = re.compile(r"^[\w.@$]+\[(.+)\]$")


def parse_sprint_field(value: Any) -> list[dict]:
    """Normalize a Sprint custom-field value to a list of dicts.

    Returns [] for None or unrecognised payloads.
    """
    if not value:
        return []
    if not isinstance(value, list):
        return []

    out: list[dict] = []
    for item in value:
        if isinstance(item, dict):
            out.append(item)
        elif isinstance(item, str):
            parsed = _parse_legacy_sprint_string(item)
            if parsed is not None:
                out.append(parsed)
    return out


def _parse_legacy_sprint_string(s: str) -> dict | None:
    m = _LEGACY_SPRINT_RE.match(s.strip())
    if not m:
        return None
    body = m.group(1)
    fields: dict[str, str | None] = {}
    # Split on top-level commas; values don't contain unescaped commas in legacy format.
    for part in body.split(","):
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        v = v.strip()
        fields[k.strip()] = None if v == "<null>" else v
    if not fields.get("id"):
        return None
    try:
        sprint_id = int(fields["id"])  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return {
        "id": sprint_id,
        "name": fields.get("name"),
        "state": fields.get("state"),
        "startDate": fields.get("startDate"),
        "endDate": fields.get("endDate"),
        "completeDate": fields.get("completeDate"),
        "boardId": int(fields["boardId"]) if fields.get("boardId") and fields["boardId"].isdigit() else None,
    }


def parse_iso_datetime(value: Any) -> datetime | None:
    """Parse Jira's ISO-8601 datetime strings (with Z, with offset, or with millis)."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    # Normalise trailing Z → +00:00 for fromisoformat
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None
