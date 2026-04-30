"""Per-ticket notes — local-only standup follow-ups.

Notes follow the ticket across sprints. Completed items auto-collapse:
the list endpoint returns `open` (all) plus `done_recent` (last 5 closed
in trailing 14 days) so the UI stays focused but recent context is one
toggle away.

Mounted under two prefixes:
- /api/v1/issues/{key}/notes  — list + create scoped to a ticket
- /api/v1/notes/{id}          — patch + delete by note id
- /api/v1/notes/counts        — batched count for board badges
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Issue, IssueSprint, TicketNote

router = APIRouter(prefix="/api/v1", tags=["notes"])


_DONE_RECENT_LIMIT = 5
_DONE_RECENT_WINDOW_DAYS = 14


# ---------- DTOs ----------


class TicketNoteOut(BaseModel):
    id: int
    issue_key: str
    body: str
    done: bool
    created_at: datetime
    updated_at: datetime
    done_at: datetime | None


class TicketNotesResponse(BaseModel):
    open: list[TicketNoteOut]
    done_recent: list[TicketNoteOut]


class CreateNotePayload(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class UpdateNotePayload(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=2000)
    done: bool | None = None


# ---------- helpers ----------


def _to_dto(n: TicketNote) -> TicketNoteOut:
    return TicketNoteOut(
        id=n.id,
        issue_key=n.issue_key,
        body=n.body,
        done=n.done,
        created_at=n.created_at,
        updated_at=n.updated_at,
        done_at=n.done_at,
    )


async def _ensure_issue(session: AsyncSession, issue_key: str) -> None:
    exists = (
        await session.execute(select(Issue.issue_key).where(Issue.issue_key == issue_key))
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": f"issue '{issue_key}' not found in local DB — sync first?",
            },
        )


# ---------- endpoints ----------


@router.get("/issues/{issue_key}/notes", response_model=TicketNotesResponse)
async def list_notes_for_issue(
    issue_key: str, session: AsyncSession = Depends(get_session)
) -> TicketNotesResponse:
    await _ensure_issue(session, issue_key)
    open_rows = (
        await session.execute(
            select(TicketNote)
            .where(TicketNote.issue_key == issue_key, TicketNote.done.is_(False))
            .order_by(TicketNote.created_at.asc())
        )
    ).scalars().all()
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=_DONE_RECENT_WINDOW_DAYS)
    done_rows = (
        await session.execute(
            select(TicketNote)
            .where(
                TicketNote.issue_key == issue_key,
                TicketNote.done.is_(True),
                TicketNote.done_at.is_not(None),
                TicketNote.done_at >= cutoff,
            )
            .order_by(TicketNote.done_at.desc())
            .limit(_DONE_RECENT_LIMIT)
        )
    ).scalars().all()
    return TicketNotesResponse(
        open=[_to_dto(n) for n in open_rows],
        done_recent=[_to_dto(n) for n in done_rows],
    )


@router.post(
    "/issues/{issue_key}/notes",
    response_model=TicketNoteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_note(
    issue_key: str,
    payload: CreateNotePayload,
    session: AsyncSession = Depends(get_session),
) -> TicketNoteOut:
    await _ensure_issue(session, issue_key)
    note = TicketNote(issue_key=issue_key, body=payload.body)
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return _to_dto(note)


@router.patch("/notes/{note_id}", response_model=TicketNoteOut)
async def update_note(
    note_id: int,
    payload: UpdateNotePayload,
    session: AsyncSession = Depends(get_session),
) -> TicketNoteOut:
    note = (
        await session.execute(select(TicketNote).where(TicketNote.id == note_id))
    ).scalar_one_or_none()
    if note is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "note id not found"},
        )

    now = datetime.now(tz=timezone.utc)
    if payload.body is not None:
        note.body = payload.body
    if payload.done is not None and payload.done != note.done:
        note.done = payload.done
        note.done_at = now if payload.done else None
    note.updated_at = now
    await session.commit()
    await session.refresh(note)
    return _to_dto(note)


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: int, session: AsyncSession = Depends(get_session)
) -> None:
    result = await session.execute(
        delete(TicketNote).where(TicketNote.id == note_id)
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "note id not found"},
        )
    await session.commit()


@router.get("/notes/counts", response_model=dict[str, int])
async def notes_counts_for_sprint(
    sprint_id: int = Query(..., description="Sprint id whose tickets we want note-counts for"),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    """Count of OPEN notes per issue_key, scoped to the given sprint's tickets.

    Powers the `📝 N` badges on the standup board so we don't make N
    round trips. Issues with zero open notes are omitted from the dict.
    """
    rows = (
        await session.execute(
            select(TicketNote.issue_key, func.count(TicketNote.id))
            .join(IssueSprint, IssueSprint.issue_key == TicketNote.issue_key)
            .where(
                and_(
                    IssueSprint.sprint_id == sprint_id,
                    TicketNote.done.is_(False),
                )
            )
            .group_by(TicketNote.issue_key)
        )
    ).all()
    return {key: count for key, count in rows}
