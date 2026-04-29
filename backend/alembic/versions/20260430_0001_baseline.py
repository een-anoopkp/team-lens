"""baseline schema (Phase 1.3)

Revision ID: 20260430_0001
Revises:
Create Date: 2026-04-30

Covers all tables described in docs/local-app/02-database-schema.md.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260430_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- people --------------------------------------------------------------
    op.create_table(
        "people",
        sa.Column("account_id", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("account_id"),
    )

    # ---- sprints -------------------------------------------------------------
    op.create_table(
        "sprints",
        sa.Column("sprint_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("complete_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("board_id", sa.BigInteger(), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("sprint_id"),
    )
    op.create_index("sprints_state_idx", "sprints", ["state"])
    op.create_index("sprints_name_idx", "sprints", ["name"])

    # ---- initiatives ---------------------------------------------------------
    op.create_table(
        "initiatives",
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("status_category", sa.String(), nullable=False),
        sa.Column("owner_account_id", sa.String(), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["owner_account_id"], ["people.account_id"]),
        sa.PrimaryKeyConstraint("issue_key"),
    )

    # ---- epics ---------------------------------------------------------------
    op.create_table(
        "epics",
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("status_category", sa.String(), nullable=False),
        sa.Column("initiative_key", sa.String(), nullable=True),
        sa.Column("owner_account_id", sa.String(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["initiative_key"], ["initiatives.issue_key"]),
        sa.ForeignKeyConstraint(["owner_account_id"], ["people.account_id"]),
        sa.PrimaryKeyConstraint("issue_key"),
    )
    op.create_index("epics_initiative_idx", "epics", ["initiative_key"])
    op.create_index("epics_due_date_idx", "epics", ["due_date"])

    # ---- issues --------------------------------------------------------------
    op.create_table(
        "issues",
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("issue_type", sa.String(), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("status_category", sa.String(), nullable=False),
        sa.Column("assignee_id", sa.String(), nullable=True),
        sa.Column("reporter_id", sa.String(), nullable=True),
        sa.Column("parent_key", sa.String(), nullable=True),
        sa.Column("epic_key", sa.String(), nullable=True),
        sa.Column("story_points", sa.Numeric(6, 2), nullable=True),
        sa.Column("resolution_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["assignee_id"], ["people.account_id"]),
        sa.ForeignKeyConstraint(["reporter_id"], ["people.account_id"]),
        sa.ForeignKeyConstraint(["epic_key"], ["epics.issue_key"]),
        sa.PrimaryKeyConstraint("issue_key"),
    )
    op.create_index(
        "issues_assignee_idx", "issues", ["assignee_id"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index(
        "issues_epic_idx", "issues", ["epic_key"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index(
        "issues_parent_idx", "issues", ["parent_key"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index(
        "issues_status_cat_idx", "issues", ["status_category"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index(
        "issues_type_idx", "issues", ["issue_type"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index(
        "issues_resolved_idx", "issues", ["resolution_date"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index("issues_updated_idx", "issues", ["updated_at"])

    # ---- issue_sprints -------------------------------------------------------
    op.create_table(
        "issue_sprints",
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("sprint_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["issue_key"], ["issues.issue_key"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sprint_id"], ["sprints.sprint_id"]),
        sa.PrimaryKeyConstraint("issue_key", "sprint_id"),
    )
    op.create_index("issue_sprints_sprint_idx", "issue_sprints", ["sprint_id"])

    # ---- ticket_state_snapshots ---------------------------------------------
    op.create_table(
        "ticket_state_snapshots",
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("sprint_name", sa.String(), nullable=False),
        sa.Column("first_sp", sa.Numeric(6, 2), nullable=True),
        sa.Column("last_sp", sa.Numeric(6, 2), nullable=True),
        sa.Column("last_assignee", sa.String(), nullable=True),
        sa.Column("last_status", sa.String(), nullable=True),
        sa.Column(
            "was_added_mid_sprint",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("issue_key", "sprint_name"),
    )

    # ---- scope_change_events -------------------------------------------------
    op.create_table(
        "scope_change_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("sprint_name", sa.String(), nullable=False),
        sa.Column("change_type", sa.String(), nullable=False),
        sa.Column("old_value", sa.String(), nullable=True),
        sa.Column("new_value", sa.String(), nullable=True),
        sa.Column("sp_delta", sa.Numeric(6, 2), nullable=True),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("scope_events_sprint_idx", "scope_change_events", ["sprint_name"])
    op.create_index(
        "scope_events_type_idx",
        "scope_change_events",
        ["change_type", sa.text("detected_at DESC")],
    )

    # ---- comments ------------------------------------------------------------
    op.create_table(
        "comments",
        sa.Column("comment_id", sa.String(), nullable=False),
        sa.Column("issue_key", sa.String(), nullable=False),
        sa.Column("author_id", sa.String(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("body_adf", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "local_origin", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["issue_key"], ["issues.issue_key"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["people.account_id"]),
        sa.PrimaryKeyConstraint("comment_id"),
    )
    op.create_index(
        "comments_issue_idx", "comments", ["issue_key"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index(
        "comments_author_idx",
        "comments",
        ["author_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.create_index(
        "comments_created_idx",
        "comments",
        [sa.text("created_at DESC")],
    )

    # ---- holidays ------------------------------------------------------------
    op.create_table(
        "holidays",
        sa.Column("holiday_date", sa.Date(), nullable=False),
        sa.Column("region", sa.String(), nullable=False, server_default="IN"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("holiday_date", "region"),
    )
    op.create_index("holidays_date_idx", "holidays", ["holiday_date"])

    # ---- leaves --------------------------------------------------------------
    op.create_table(
        "leaves",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("person_account_id", sa.String(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("end_date >= start_date", name="leaves_end_after_start"),
        sa.ForeignKeyConstraint(["person_account_id"], ["people.account_id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("leaves_person_idx", "leaves", ["person_account_id"])
    op.create_index("leaves_dates_idx", "leaves", ["start_date", "end_date"])

    # ---- local_settings ------------------------------------------------------
    op.create_table(
        "local_settings",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("key"),
    )

    # ---- project_snapshots --------------------------------------------------
    op.create_table(
        "project_snapshots",
        sa.Column("project_name", sa.String(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("epic_count", sa.Integer(), nullable=False),
        sa.Column(
            "epic_keys", postgresql.ARRAY(sa.String()), nullable=False
        ),
        sa.Column("total_sp", sa.Numeric(8, 2), nullable=False),
        sa.Column("sprints_active", sa.Integer(), nullable=False),
        sa.Column("first_sprint_name", sa.String(), nullable=True),
        sa.Column("last_sprint_name", sa.String(), nullable=True),
        sa.Column("avg_velocity_sp", sa.Numeric(8, 2), nullable=True),
        sa.Column("avg_sprint_length_d", sa.Numeric(5, 2), nullable=True),
        sa.Column("scope_churn_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("sp_added_total", sa.Numeric(8, 2), nullable=True),
        sa.Column("sp_removed_total", sa.Numeric(8, 2), nullable=True),
        sa.Column("contributors", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("initiative_keys", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("raw_metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "snapshot_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("project_name"),
    )
    op.create_index(
        "project_snapshots_completed_idx",
        "project_snapshots",
        [sa.text("completed_at DESC")],
    )

    # ---- sync_runs -----------------------------------------------------------
    op.create_table(
        "sync_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("scan_type", sa.String(), nullable=False),
        sa.Column("trigger", sa.String(), nullable=False),
        sa.Column("issues_seen", sa.Integer(), server_default="0"),
        sa.Column("issues_inserted", sa.Integer(), server_default="0"),
        sa.Column("issues_updated", sa.Integer(), server_default="0"),
        sa.Column("issues_removed", sa.Integer(), server_default="0"),
        sa.Column("sp_changes", sa.Integer(), server_default="0"),
        sa.Column("assignee_changes", sa.Integer(), server_default="0"),
        sa.Column("status_changes", sa.Integer(), server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "sync_runs_started_idx",
        "sync_runs",
        [sa.text("started_at DESC")],
    )
    op.create_index(
        "sync_runs_success_idx",
        "sync_runs",
        [sa.text("finished_at DESC")],
        postgresql_where=sa.text("status = 'success'"),
    )


def downgrade() -> None:
    op.drop_index("sync_runs_success_idx", table_name="sync_runs")
    op.drop_index("sync_runs_started_idx", table_name="sync_runs")
    op.drop_table("sync_runs")

    op.drop_index("project_snapshots_completed_idx", table_name="project_snapshots")
    op.drop_table("project_snapshots")

    op.drop_table("local_settings")

    op.drop_index("leaves_dates_idx", table_name="leaves")
    op.drop_index("leaves_person_idx", table_name="leaves")
    op.drop_table("leaves")

    op.drop_index("holidays_date_idx", table_name="holidays")
    op.drop_table("holidays")

    op.drop_index("comments_created_idx", table_name="comments")
    op.drop_index("comments_author_idx", table_name="comments")
    op.drop_index("comments_issue_idx", table_name="comments")
    op.drop_table("comments")

    op.drop_index("scope_events_type_idx", table_name="scope_change_events")
    op.drop_index("scope_events_sprint_idx", table_name="scope_change_events")
    op.drop_table("scope_change_events")

    op.drop_table("ticket_state_snapshots")

    op.drop_index("issue_sprints_sprint_idx", table_name="issue_sprints")
    op.drop_table("issue_sprints")

    op.drop_index("issues_updated_idx", table_name="issues")
    op.drop_index("issues_resolved_idx", table_name="issues")
    op.drop_index("issues_type_idx", table_name="issues")
    op.drop_index("issues_status_cat_idx", table_name="issues")
    op.drop_index("issues_parent_idx", table_name="issues")
    op.drop_index("issues_epic_idx", table_name="issues")
    op.drop_index("issues_assignee_idx", table_name="issues")
    op.drop_table("issues")

    op.drop_index("epics_due_date_idx", table_name="epics")
    op.drop_index("epics_initiative_idx", table_name="epics")
    op.drop_table("epics")

    op.drop_table("initiatives")

    op.drop_index("sprints_name_idx", table_name="sprints")
    op.drop_index("sprints_state_idx", table_name="sprints")
    op.drop_table("sprints")

    op.drop_table("people")
