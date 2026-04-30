"""Raw projects view — label-derived list, no ETD math.

Phase 1 surface only. Full /projects + /projects/comparison endpoints
land in Phase 5; this one exists so the /debug page can verify that
proj_* labels are being captured correctly during sync.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Epic, ProjectSnapshot
from app.sync.projects import extract_project_labels

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


class ProjectRaw(BaseModel):
    project_name: str
    epic_count: int
    epic_keys: list[str]
    epic_status_categories: dict[str, int]
    classification: Literal["active", "completed"]


@router.get("/raw", response_model=list[ProjectRaw])
async def list_projects_raw(
    session: AsyncSession = Depends(get_session),
) -> list[ProjectRaw]:
    epics = (await session.execute(select(Epic))).scalars().all()
    by_project: dict[str, list[Epic]] = defaultdict(list)
    for epic in epics:
        for proj in extract_project_labels(epic.raw_payload):
            by_project[proj].append(epic)

    # Existing snapshots — anything in here is officially "completed"
    snap_names = {
        s.project_name
        for s in (await session.execute(select(ProjectSnapshot.project_name))).scalars().all()
    }

    out: list[ProjectRaw] = []
    for project_name, project_epics in sorted(by_project.items()):
        cat_counts: dict[str, int] = defaultdict(int)
        for e in project_epics:
            cat_counts[e.status_category] += 1
        all_done = all(e.status_category == "done" for e in project_epics)
        classification = (
            "completed" if (all_done or project_name in snap_names) else "active"
        )
        out.append(
            ProjectRaw(
                project_name=project_name,
                epic_count=len(project_epics),
                epic_keys=sorted(e.issue_key for e in project_epics),
                epic_status_categories=dict(cat_counts),
                classification=classification,
            )
        )
    return out
