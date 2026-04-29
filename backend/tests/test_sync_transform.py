"""Pure-function tests for sync.transform."""

from __future__ import annotations

from app.jira.fields import FieldRegistry
from app.sync.transform import (
    collect_people_from_issue,
    comment_from_jira,
    epic_from_jira,
    extract_adf_text,
    initiative_from_jira,
    issue_from_jira,
    issue_sprint_pairs,
    person_from_user,
    sprint_from_jira,
    sprints_from_issue,
)


def _adf_paragraph(text: str) -> dict:
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": text}],
            }
        ],
    }


# ---------- ADF -------------------------------------------------------------

def test_extract_adf_text_simple_paragraph() -> None:
    assert extract_adf_text(_adf_paragraph("hello world")) == "hello world"


def test_extract_adf_text_handles_hard_break() -> None:
    adf = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "line1"},
                    {"type": "hardBreak"},
                    {"type": "text", "text": "line2"},
                ],
            }
        ],
    }
    assert "line1" in extract_adf_text(adf)
    assert "line2" in extract_adf_text(adf)


def test_extract_adf_text_returns_empty_for_none_or_string() -> None:
    assert extract_adf_text(None) == ""
    assert extract_adf_text("plain text") == ""
    assert extract_adf_text({}) == ""


# ---------- People ----------------------------------------------------------

def test_person_from_user_returns_none_without_account_id() -> None:
    assert person_from_user(None) is None
    assert person_from_user({"displayName": "X"}) is None


def test_person_from_user_extracts_fields() -> None:
    p = person_from_user(
        {"accountId": "a1", "displayName": "Alice", "emailAddress": "a@x", "active": True}
    )
    assert p == {"account_id": "a1", "display_name": "Alice", "email": "a@x", "active": True}


def test_collect_people_from_issue_dedupes() -> None:
    issue = {
        "fields": {
            "assignee": {"accountId": "a1", "displayName": "Alice"},
            "reporter": {"accountId": "a1", "displayName": "Alice"},
            "creator": {"accountId": "a2", "displayName": "Bob"},
        }
    }
    people = collect_people_from_issue(issue)
    assert {p["account_id"] for p in people} == {"a1", "a2"}


# ---------- Sprints ---------------------------------------------------------

def test_sprint_from_jira_normalises_dates() -> None:
    raw = {
        "id": 18279,
        "name": "Search 2026-08",
        "state": "closed",
        "startDate": "2026-04-16T14:37:51.111Z",
        "endDate": "2026-04-29T09:30:00.000Z",
        "completeDate": None,
        "boardId": 135,
    }
    row = sprint_from_jira(raw)
    assert row["sprint_id"] == 18279
    assert row["start_date"] is not None
    assert row["end_date"] is not None
    assert row["complete_date"] is None
    assert row["board_id"] == 135


# ---------- Issues / Epics / Initiatives -----------------------------------

def _epic_parent(key: str) -> dict:
    return {"key": key, "fields": {"issuetype": {"name": "Epic"}}}


def _initiative_parent(key: str) -> dict:
    return {"key": key, "fields": {"issuetype": {"name": "Initiative"}}}


def test_issue_from_jira_extracts_core_fields() -> None:
    fields = FieldRegistry()
    issue = {
        "key": "EEPD-1",
        "fields": {
            "summary": "Do the thing",
            "issuetype": {"name": "Story"},
            "status": {"name": "Closed", "statusCategory": {"key": "done"}},
            "assignee": {"accountId": "a1", "displayName": "Alice"},
            "reporter": None,
            "parent": _epic_parent("EEPD-100"),
            "resolutiondate": "2026-04-29T05:57:18.328-0500",
            "duedate": "2026-04-30",
            "updated": "2026-04-29T05:57:18.328-0500",
            "created": "2026-04-15T00:00:00.000Z",
            fields.story_points: 5,
        },
    }
    row = issue_from_jira(issue, fields)
    assert row["issue_key"] == "EEPD-1"
    assert row["issue_type"] == "Story"
    assert row["status_category"] == "done"
    assert row["assignee_id"] == "a1"
    assert row["epic_key"] == "EEPD-100"
    assert row["parent_key"] == "EEPD-100"
    assert row["story_points"] == 5
    assert row["resolution_date"] is not None
    assert row["due_date"] is not None


def test_issue_from_jira_subtask_does_not_set_epic_key() -> None:
    fields = FieldRegistry()
    issue = {
        "key": "EEPD-2",
        "fields": {
            "summary": "subtask",
            "issuetype": {"name": "Sub-task"},
            "status": {"name": "Open", "statusCategory": {"key": "new"}},
            "parent": {"key": "EEPD-1", "fields": {"issuetype": {"name": "Story"}}},
            "updated": "2026-04-29T00:00:00Z",
        },
    }
    row = issue_from_jira(issue, fields)
    assert row["parent_key"] == "EEPD-1"
    assert row["epic_key"] is None


def test_epic_from_jira_links_initiative_when_parent_is_initiative() -> None:
    issue = {
        "key": "EEPD-100",
        "fields": {
            "summary": "Epic",
            "issuetype": {"name": "Epic"},
            "status": {"name": "In Progress", "statusCategory": {"key": "indeterminate"}},
            "parent": _initiative_parent("EEPD-9999"),
        },
    }
    row = epic_from_jira(issue)
    assert row["initiative_key"] == "EEPD-9999"


def test_epic_from_jira_no_initiative_when_no_parent() -> None:
    issue = {
        "key": "EEPD-100",
        "fields": {
            "summary": "Epic",
            "issuetype": {"name": "Epic"},
            "status": {"name": "In Progress", "statusCategory": {"key": "indeterminate"}},
        },
    }
    assert epic_from_jira(issue)["initiative_key"] is None


def test_initiative_from_jira() -> None:
    issue = {
        "key": "EEPD-9999",
        "fields": {
            "summary": "Big initiative",
            "issuetype": {"name": "Initiative"},
            "status": {"name": "Open", "statusCategory": {"key": "new"}},
        },
    }
    row = initiative_from_jira(issue)
    assert row["issue_key"] == "EEPD-9999"
    assert row["status_category"] == "new"


# ---------- Sprint membership extraction ------------------------------------

def test_issue_sprint_pairs_filters_by_prefix() -> None:
    fields = FieldRegistry()
    issue = {
        "key": "EEPD-1",
        "fields": {
            fields.sprint: [
                {"id": 18279, "name": "Search 2026-08", "state": "closed"},
                {"id": 99, "name": "Other-Team-Sprint", "state": "closed"},
            ]
        },
    }
    pairs = issue_sprint_pairs(issue, fields, sprint_name_prefix="Search 20")
    assert pairs == [("EEPD-1", 18279)]


def test_sprints_from_issue_filters_by_prefix() -> None:
    fields = FieldRegistry()
    issue = {
        "key": "EEPD-1",
        "fields": {
            fields.sprint: [
                {"id": 18279, "name": "Search 2026-08", "state": "closed"},
                {"id": 99, "name": "Other", "state": "closed"},
            ]
        },
    }
    sprints = sprints_from_issue(issue, fields, sprint_name_prefix="Search 20")
    assert [s["sprint_id"] for s in sprints] == [18279]


# ---------- Comments --------------------------------------------------------

def test_comment_from_jira_extracts_body_text_from_adf() -> None:
    c = {
        "id": "c1",
        "author": {"accountId": "a1", "displayName": "Alice"},
        "body": _adf_paragraph("Looks good!"),
        "created": "2026-04-29T00:00:00Z",
        "updated": "2026-04-29T00:01:00Z",
    }
    row = comment_from_jira(c, "EEPD-1")
    assert row["comment_id"] == "c1"
    assert row["author_id"] == "a1"
    assert "Looks good" in row["body_text"]
    assert isinstance(row["body_adf"], dict)
