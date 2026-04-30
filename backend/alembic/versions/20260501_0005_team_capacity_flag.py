"""team_members.counts_for_capacity flag

Revision ID: 20260501_0005
Revises: 20260430_0004
Create Date: 2026-05-01

Adds a boolean to mark team members whose tickets shouldn't drive sprint
capacity / velocity computations — e.g. team leads who don't own tickets,
or embedded QA who follow a separate flow. Defaults true so existing
members keep counting.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260501_0005"
down_revision: str | None = "20260430_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "team_members",
        sa.Column(
            "counts_for_capacity",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("team_members", "counts_for_capacity")
