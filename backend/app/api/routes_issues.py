"""Issue listing + detail + scope-change events."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import (
    Comment,
    Issue,
    IssueSprint,
    ScopeChangeEvent,
    Sprint,
    TicketStateSnapshot,
)

router = APIRouter(prefix="/api/v1", tags=["issues"])


class IssueOut(BaseModel):
    issue_key: str
    issue_type: str
    summary: str
    status: str
    status_category: str
    assignee_id: str | None
    reporter_id: str | None
    parent_key: str | None
    epic_key: str | None
    story_points: Decimal | None
    resolution_date: datetime | None
    due_date: date | None
    updated_at: datetime
    last_seen_at: datetime
    removed_at: datetime | None


class IssuesPage(BaseModel):
    issues: list[IssueOut]
    next_cursor: str | None
    total_estimate: int | None = None


class IssueDetail(IssueOut):
    sprint_ids: list[int]
    comments: list[dict[str, Any]]
    snapshots: list[dict[str, Any]]


class ScopeChangeOut(BaseModel):
    id: int
    issue_key: str
    sprint_name: str
    change_type: str
    old_value: str | None
    new_value: str | None
    sp_delta: Decimal | None
    detected_at: datetime


# ---- Issues -----------------------------------------------------------------

def _to_out(i: Issue) -> IssueOut:
    return IssueOut(
        issue_key=i.issue_key,
        issue_type=i.issue_type,
        summary=i.summary,
        status=i.status,
        status_category=i.status_category,
        assignee_id=i.assignee_id,
        reporter_id=i.reporter_id,
        parent_key=i.parent_key,
        epic_key=i.epic_key,
        story_points=i.story_points,
        resolution_date=i.resolution_date,
        due_date=i.due_date,
        updated_at=i.updated_at,
        last_seen_at=i.last_seen_at,
        removed_at=i.removed_at,
    )


@router.get("/issues", response_model=IssuesPage)
async def list_issues(
    sprint_id: int | None = None,
    assignee: str | None = None,
    status_category: Literal["new", "indeterminate", "done"] | None = None,
    issue_type: str | None = None,
    epic_key: str | None = None,
    q: str | None = Query(None, description="case-insensitive substring of summary"),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None, description="issue_key from prior page; results > this"),
    include_removed: bool = False,
    session: AsyncSession = Depends(get_session),
) -> IssuesPage:
    stmt = select(Issue)
    if not include_removed:
        stmt = stmt.where(Issue.removed_at.is_(None))
    if sprint_id is not None:
        stmt = stmt.join(IssueSprint, IssueSprint.issue_key == Issue.issue_key).where(
            IssueSprint.sprint_id == sprint_id
        )
    if assignee is not None:
        stmt = stmt.where(Issue.assignee_id == assignee)
    if status_category is not None:
        stmt = stmt.where(Issue.status_category == status_category)
    if issue_type is not None:
        stmt = stmt.where(Issue.issue_type == issue_type)
    if epic_key is not None:
        stmt = stmt.where(Issue.epic_key == epic_key)
    if q:
        stmt = stmt.where(Issue.summary.ilike(f"%{q}%"))
    if cursor is not None:
        stmt = stmt.where(Issue.issue_key > cursor)
    stmt = stmt.order_by(Issue.issue_key.asc()).limit(limit + 1)

    rows = (await session.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    page = rows[:limit]
    return IssuesPage(
        issues=[_to_out(i) for i in page],
        next_cursor=page[-1].issue_key if has_more and page else None,
    )


@router.get("/issues/{issue_key}", response_model=IssueDetail)
async def get_issue(
    issue_key: str,
    session: AsyncSession = Depends(get_session),
) -> IssueDetail:
    issue = (
        await session.execute(select(Issue).where(Issue.issue_key == issue_key))
    ).scalar_one_or_none()
    if issue is None:
        raise HTTPException(404, detail={"error": "not_found", "message": "issue not found"})

    sprint_ids = [
        sid
        for (sid,) in (
            await session.execute(
                select(IssueSprint.sprint_id).where(IssueSprint.issue_key == issue_key)
            )
        ).all()
    ]

    comment_rows = (
        await session.execute(
            select(Comment)
            .where(Comment.issue_key == issue_key, Comment.removed_at.is_(None))
            .order_by(Comment.created_at.asc())
        )
    ).scalars().all()
    comments = [
        {
            "comment_id": c.comment_id,
            "author_id": c.author_id,
            "body_text": c.body_text,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
            "local_origin": c.local_origin,
        }
        for c in comment_rows
    ]

    snap_rows = (
        await session.execute(
            select(TicketStateSnapshot, Sprint.name)
            .join(Sprint, Sprint.name == TicketStateSnapshot.sprint_name, isouter=True)
            .where(TicketStateSnapshot.issue_key == issue_key)
        )
    ).all()
    snapshots = [
        {
            "sprint_name": snap.sprint_name,
            "first_sp": snap.first_sp,
            "last_sp": snap.last_sp,
            "last_assignee": snap.last_assignee,
            "last_status": snap.last_status,
            "was_added_mid_sprint": snap.was_added_mid_sprint,
            "first_seen_at": snap.first_seen_at,
            "last_seen_at": snap.last_seen_at,
        }
        for (snap, _name) in snap_rows
    ]

    base = _to_out(issue).model_dump()
    return IssueDetail(**base, sprint_ids=sprint_ids, comments=comments, snapshots=snapshots)


# ---- Scope-change events ----------------------------------------------------

@router.get("/scope-changes", response_model=list[ScopeChangeOut])
async def list_scope_changes(
    sprint_name: str | None = None,
    issue_key: str | None = None,
    change_type: Literal["sp", "assignee", "status", "added_mid_sprint"] | None = None,
    since: datetime | None = None,
    limit: int = Query(100, ge=1, le=1000),
    session: AsyncSession = Depends(get_session),
) -> list[ScopeChangeOut]:
    stmt = select(ScopeChangeEvent)
    if sprint_name:
        stmt = stmt.where(ScopeChangeEvent.sprint_name == sprint_name)
    if issue_key:
        stmt = stmt.where(ScopeChangeEvent.issue_key == issue_key)
    if change_type:
        stmt = stmt.where(ScopeChangeEvent.change_type == change_type)
    if since is not None:
        stmt = stmt.where(ScopeChangeEvent.detected_at >= since)
    stmt = stmt.order_by(ScopeChangeEvent.detected_at.desc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        ScopeChangeOut(
            id=r.id,
            issue_key=r.issue_key,
            sprint_name=r.sprint_name,
            change_type=r.change_type,
            old_value=r.old_value,
            new_value=r.new_value,
            sp_delta=r.sp_delta,
            detected_at=r.detected_at,
        )
        for r in rows
    ]
