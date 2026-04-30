"""insights — anomaly + LLM rule outputs

Revision ID: 20260430_0004
Revises: 20260430_0003
Create Date: 2026-04-30

Two tables:
- insight_rules: persists the on/off toggle + per-rule config overrides.
  Rule definitions themselves are hardcoded in app.insights.registry;
  this table just records mutable state.
- insight_runs: one row per evaluation. Anomalies write a row per sync
  per rule; LLM rules write a row per Run-for invocation. Retention is
  90 days, enforced by a daily cleanup job.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260430_0004"
down_revision: str | None = "20260430_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "insight_rules",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),  # 'anomaly' | 'llm'
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "config",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "insight_runs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("rule_id", sa.String(), nullable=False),
        sa.Column("trigger", sa.String(), nullable=False),
        sa.Column("scope", JSONB(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", JSONB(), nullable=True),
        sa.Column("body_md", sa.Text(), nullable=True),
        sa.Column("prompt_version", sa.Integer(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["rule_id"], ["insight_rules.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        "CREATE SEQUENCE IF NOT EXISTS insight_runs_id_seq OWNED BY insight_runs.id"
    )
    op.execute(
        "ALTER TABLE insight_runs ALTER COLUMN id SET DEFAULT nextval('insight_runs_id_seq')"
    )
    op.create_index(
        "insight_runs_rule_started_idx",
        "insight_runs",
        ["rule_id", sa.text("started_at DESC")],
    )
    op.create_index("insight_runs_status_idx", "insight_runs", ["status"])


def downgrade() -> None:
    op.drop_index("insight_runs_status_idx", table_name="insight_runs")
    op.drop_index("insight_runs_rule_started_idx", table_name="insight_runs")
    op.drop_table("insight_runs")
    op.execute("DROP SEQUENCE IF EXISTS insight_runs_id_seq")
    op.drop_table("insight_rules")
