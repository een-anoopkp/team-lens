"""ticket_notes — local per-ticket to-do list

Revision ID: 20260430_0003
Revises: 20260430_0002
Create Date: 2026-04-30

Adds a local-only to-do list per Jira ticket. Used by the standup-board
sub-tab on /sprint-health/board to capture standup follow-ups without
posting them as Jira comments. Notes follow the ticket across sprints;
completed items auto-collapse in the UI but stay in the table.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260430_0003"
down_revision: str | None = "20260430_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ticket_notes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "done", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["issue_key"], ["issues.issue_key"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ticket_notes_issue_idx", "ticket_notes", ["issue_key"], unique=False
    )
    op.create_index(
        "ticket_notes_open_idx",
        "ticket_notes",
        ["issue_key"],
        unique=False,
        postgresql_where=sa.text("done = false"),
    )


def downgrade() -> None:
    op.drop_index("ticket_notes_open_idx", table_name="ticket_notes")
    op.drop_index("ticket_notes_issue_idx", table_name="ticket_notes")
    op.drop_table("ticket_notes")
