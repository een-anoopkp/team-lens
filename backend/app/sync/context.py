"""Persistent dependencies threaded through every sync worker.

`SyncRunner` builds one `SyncContext` per process and passes it to the
module-level workers in `sync/sprints.py`, `sync/issues.py`, etc.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.jira.fields import FieldRegistry


@dataclass(frozen=True, slots=True)
class SyncContext:
    settings: Settings
    session_factory: async_sessionmaker[AsyncSession]
    fields: FieldRegistry
