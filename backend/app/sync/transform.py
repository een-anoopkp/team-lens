"""Pure functions: Jira JSON → ORM-ready dicts. No DB access here.

Includes a minimal ADF (Atlassian Document Format) walker that extracts
plain text from comment / description bodies.
"""

from __future__ import annotations

from datetime import date as date_t
from datetime import datetime
from typing import Any

from app.jira.fields import FieldRegistry
from app.jira.parsers import parse_iso_datetime, parse_sprint_field


# ---------- ADF text extraction ----------------------------------------------

def extract_adf_text(adf: Any) -> str:
    """Walk an ADF document and return concatenated plaintext.

    - Text nodes contribute their `text` value.
    - hardBreak / paragraph / heading insert newlines.
    - Other inline marks (em, strong, link, code) pass their text through.
    - Returns "" for None / non-dict input.
    """
    if not isinstance(adf, dict):
        return ""

    parts: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
            return
        if not isinstance(node, dict):
            return
        node_type = node.get("type")
        if node_type == "text" and "text" in node:
            parts.append(str(node["text"]))
            return
        if node_type == "hardBreak":
            parts.append("\n")
            return
        # Recurse into children
        for child in node.get("content", []) or []:
            walk(child)
        if node_type in ("paragraph", "heading", "blockquote", "listItem"):
            parts.append("\n")

    walk(adf)
    return "".join(parts).strip()


# ---------- People -----------------------------------------------------------

def person_from_user(user: dict | None) -> dict | None:
    """Convert a Jira user object to a `people` row dict, or None if input is None."""
    if not user:
        return None
    account_id = user.get("accountId")
    if not account_id:
        return None
    return {
        "account_id": account_id,
        "display_name": user.get("displayName") or account_id,
        "email": user.get("emailAddress"),
        "active": user.get("active", True),
    }


def collect_people_from_issue(issue: dict) -> list[dict]:
    """Return all distinct people referenced by an issue (assignee, reporter, comment authors)."""
    seen: dict[str, dict] = {}
    fields = issue.get("fields", {}) or {}
    for raw in (fields.get("assignee"), fields.get("reporter"), fields.get("creator")):
        p = person_from_user(raw)
        if p:
            seen[p["account_id"]] = p
    return list(seen.values())


# ---------- Sprints ----------------------------------------------------------

def sprint_from_jira(sprint: dict) -> dict:
    return {
        "sprint_id": sprint["id"],
        "name": sprint.get("name", ""),
        "state": sprint.get("state", "unknown"),
        "start_date": parse_iso_datetime(sprint.get("startDate")),
        "end_date": parse_iso_datetime(sprint.get("endDate")),
        "complete_date": parse_iso_datetime(sprint.get("completeDate")),
        "board_id": sprint.get("boardId") or sprint.get("originBoardId"),
        "raw_payload": sprint,
    }


# ---------- Issues / Epics / Initiatives -------------------------------------

def _due_date(value: Any) -> date_t | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def _status_category_key(status: dict | None) -> str:
    if not status:
        return "new"
    cat = status.get("statusCategory") or {}
    return cat.get("key") or "new"


def _team_field_value_id(fields: dict, team_field: str) -> str | None:
    """Extract the team UUID from cf[10500]'s payload.

    On this tenant cf[10500] is an object {"id": uuid, "name": "Search (290)", ...}
    """
    raw = fields.get(team_field)
    if isinstance(raw, dict):
        return raw.get("id")
    return None


def issue_from_jira(issue: dict, fields_reg: FieldRegistry) -> dict:
    """Top-level row for `issues`. Caller decides if epic/initiative go elsewhere."""
    fields = issue.get("fields", {}) or {}
    issuetype = (fields.get("issuetype") or {}).get("name", "Unknown")
    status = fields.get("status") or {}
    parent = fields.get("parent") or {}

    return {
        "issue_key": issue["key"],
        "issue_type": issuetype,
        "summary": fields.get("summary", "")[:1000],
        "status": status.get("name", "Unknown"),
        "status_category": _status_category_key(status),
        "assignee_id": (fields.get("assignee") or {}).get("accountId"),
        "reporter_id": (fields.get("reporter") or {}).get("accountId"),
        "parent_key": parent.get("key"),
        "epic_key": _epic_key_from_parent(parent),
        "story_points": fields.get(fields_reg.story_points),
        "resolution_date": parse_iso_datetime(fields.get("resolutiondate")),
        "due_date": _due_date(fields.get("duedate")),
        "updated_at": parse_iso_datetime(fields.get("updated"))
        or parse_iso_datetime(fields.get("created"))
        or datetime.utcnow(),
        "raw_payload": issue,
    }


def _epic_key_from_parent(parent: dict) -> str | None:
    """Return parent.key only if parent is an Epic. Stories' parents are Epics; sub-tasks' parents are Tasks."""
    if not parent:
        return None
    issuetype = ((parent.get("fields") or {}).get("issuetype") or {})
    if (issuetype.get("name") or "").strip() == "Epic":
        return parent.get("key")
    return None


def epic_from_jira(issue: dict) -> dict:
    """Build an `epics` row. Caller ensures issue.fields.issuetype.name == 'Epic'."""
    fields = issue.get("fields", {}) or {}
    parent = fields.get("parent") or {}
    parent_issuetype = ((parent.get("fields") or {}).get("issuetype") or {}).get("name", "")
    initiative_key = parent.get("key") if parent_issuetype == "Initiative" else None

    return {
        "issue_key": issue["key"],
        "summary": fields.get("summary", "")[:1000],
        "status": (fields.get("status") or {}).get("name", "Unknown"),
        "status_category": _status_category_key(fields.get("status")),
        "initiative_key": initiative_key,
        "owner_account_id": (fields.get("assignee") or {}).get("accountId"),
        "due_date": _due_date(fields.get("duedate")),
        "raw_payload": issue,
    }


def initiative_from_jira(issue: dict) -> dict:
    fields = issue.get("fields", {}) or {}
    return {
        "issue_key": issue["key"],
        "summary": fields.get("summary", "")[:1000],
        "status": (fields.get("status") or {}).get("name", "Unknown"),
        "status_category": _status_category_key(fields.get("status")),
        "owner_account_id": (fields.get("assignee") or {}).get("accountId"),
        "raw_payload": issue,
    }


# ---------- Issue ↔ Sprint membership ---------------------------------------

def issue_sprint_pairs(
    issue: dict, fields_reg: FieldRegistry, *, sprint_name_prefix: str | None = None
) -> list[tuple[str, int]]:
    """Return (issue_key, sprint_id) pairs for the issue's current sprint memberships.

    Optionally filter to sprints whose name starts with `sprint_name_prefix`.
    """
    fields = issue.get("fields", {}) or {}
    raw = fields.get(fields_reg.sprint)
    sprints = parse_sprint_field(raw)
    pairs: list[tuple[str, int]] = []
    for s in sprints:
        sid = s.get("id")
        name = s.get("name") or ""
        if sid is None:
            continue
        if sprint_name_prefix and not name.startswith(sprint_name_prefix):
            continue
        pairs.append((issue["key"], int(sid)))
    return pairs


def sprints_from_issue(
    issue: dict, fields_reg: FieldRegistry, *, sprint_name_prefix: str | None = None
) -> list[dict]:
    """Sprint dicts ready for upsert that came embedded in an issue's sprint custom field."""
    fields = issue.get("fields", {}) or {}
    out: list[dict] = []
    for s in parse_sprint_field(fields.get(fields_reg.sprint)):
        if sprint_name_prefix and not (s.get("name") or "").startswith(sprint_name_prefix):
            continue
        if s.get("id") is None:
            continue
        out.append(sprint_from_jira(s))
    return out


# ---------- Comments ---------------------------------------------------------

def comment_from_jira(comment: dict, issue_key: str) -> dict:
    body = comment.get("body")
    body_text = extract_adf_text(body) if isinstance(body, dict) else (body or "")
    if isinstance(body_text, str) and len(body_text) > 100_000:
        body_text = body_text[:100_000]
    return {
        "comment_id": comment["id"],
        "issue_key": issue_key,
        "author_id": (comment.get("author") or {}).get("accountId"),
        "body_text": body_text or "",
        "body_adf": body if isinstance(body, dict) else None,
        "created_at": parse_iso_datetime(comment.get("created")),
        "updated_at": parse_iso_datetime(comment.get("updated"))
        or parse_iso_datetime(comment.get("created")),
        "local_origin": False,
    }
