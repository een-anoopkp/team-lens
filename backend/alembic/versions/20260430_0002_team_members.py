"""team_members whitelist (post-Phase-6)

Revision ID: 20260430_0002
Revises: 20260430_0001
Create Date: 2026-04-30

Adds an explicit whitelist of current Search-team members. Replaces the
heuristic "anyone assigned in last 60 days" with user-managed truth.
Pages: Leaderboard + Leave dropdown filter to this table; historical
views (Sprint Health, project drill-ins) still show whoever did the work.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260430_0002"
down_revision: str | None = "20260430_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "team_members",
        sa.Column("account_id", sa.String(), nullable=False),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["account_id"], ["people.account_id"]),
        sa.PrimaryKeyConstraint("account_id"),
    )


def downgrade() -> None:
    op.drop_table("team_members")
