# 02 — Database Schema (Postgres 16)

Hybrid: strict columns for hot-path queries + `raw_payload jsonb` for forward-compat (add a column later, backfill from existing rows without re-syncing).

## PK conventions

- Tables backed by Jira entities use the natural Jira ID as PK (`account_id`, `sprint_id`, `issue_key`, `comment_id`). Keeps cross-system reconciliation trivial.
- Audit/history tables we own (`sync_runs`, `scope_change_events`) use `bigserial`. Append-only, never referenced from elsewhere — no need for UUIDs.
- `local_settings` uses a string `key` PK for clarity at the call site.

## DDL — core entities

```sql
CREATE TABLE people (
    account_id     text PRIMARY KEY,                -- Jira accountId
    display_name   text NOT NULL,
    email          text,
    active         boolean NOT NULL DEFAULT true,
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sprints (
    sprint_id      bigint PRIMARY KEY,
    name           text NOT NULL,
    state          text NOT NULL,                   -- active|closed|future
    start_date     timestamptz,
    end_date       timestamptz,
    complete_date  timestamptz,
    board_id       bigint,
    raw_payload    jsonb NOT NULL,
    synced_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sprints_state_idx ON sprints (state);
CREATE INDEX sprints_name_idx  ON sprints (name);

CREATE TABLE initiatives (
    issue_key        text PRIMARY KEY,
    summary          text NOT NULL,
    status           text NOT NULL,
    status_category  text NOT NULL,
    owner_account_id text REFERENCES people(account_id),
    raw_payload      jsonb NOT NULL,
    synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE epics (
    issue_key        text PRIMARY KEY,
    summary          text NOT NULL,
    status           text NOT NULL,
    status_category  text NOT NULL,
    initiative_key   text REFERENCES initiatives(issue_key),  -- NULLABLE for hygiene
    owner_account_id text REFERENCES people(account_id),
    due_date         date,
    raw_payload      jsonb NOT NULL,
    synced_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX epics_initiative_idx ON epics (initiative_key);
CREATE INDEX epics_due_date_idx   ON epics (due_date);

-- Tasks + sub-tasks share one table; issue_type discriminates.
CREATE TABLE issues (
    issue_key        text PRIMARY KEY,
    issue_type       text NOT NULL,                 -- Story|Task|Bug|Sub-task
    summary          text NOT NULL,
    status           text NOT NULL,
    status_category  text NOT NULL,                 -- raw Jira: new|indeterminate|done
    assignee_id      text REFERENCES people(account_id),
    reporter_id      text REFERENCES people(account_id),
    parent_key       text,                          -- self-FK for sub-tasks
    epic_key         text REFERENCES epics(issue_key),  -- NULLABLE for hygiene
    story_points     numeric(6,2),
    resolution_date  timestamptz,
    due_date         date,
    updated_at       timestamptz NOT NULL,          -- Jira's updated, not ours
    raw_payload      jsonb NOT NULL,
    last_seen_at     timestamptz NOT NULL DEFAULT now(),  -- updated on every sync touch
    removed_at       timestamptz,                   -- set during full scan if absent; NULL = active
    synced_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issues_assignee_idx   ON issues (assignee_id) WHERE removed_at IS NULL;
CREATE INDEX issues_epic_idx       ON issues (epic_key) WHERE removed_at IS NULL;
CREATE INDEX issues_parent_idx     ON issues (parent_key) WHERE removed_at IS NULL;
CREATE INDEX issues_status_cat_idx ON issues (status_category) WHERE removed_at IS NULL;
CREATE INDEX issues_type_idx       ON issues (issue_type) WHERE removed_at IS NULL;
CREATE INDEX issues_resolved_idx   ON issues (resolution_date) WHERE removed_at IS NULL;
CREATE INDEX issues_updated_idx    ON issues (updated_at DESC);

-- Many-to-many issue ↔ sprint; replaced wholesale per issue per sync.
CREATE TABLE issue_sprints (
    issue_key  text NOT NULL REFERENCES issues(issue_key) ON DELETE CASCADE,
    sprint_id  bigint NOT NULL REFERENCES sprints(sprint_id),
    PRIMARY KEY (issue_key, sprint_id)
);
CREATE INDEX issue_sprints_sprint_idx ON issue_sprints (sprint_id);
```

## DDL — snapshot history (the load-bearing tables for scope tracking)

```sql
-- Per-(issue, sprint) state baseline. Counterfactual semantics: first_sp = 0 for mid-sprint additions.
CREATE TABLE ticket_state_snapshots (
    issue_key             text NOT NULL,
    sprint_name           text NOT NULL,
    first_sp              numeric(6,2),                -- counterfactual baseline (0 for mid-sprint adds)
    last_sp               numeric(6,2),                -- most recent SP value
    last_assignee         text,
    last_status           text,
    was_added_mid_sprint  boolean NOT NULL DEFAULT false,
    first_seen_at         timestamptz NOT NULL,
    last_seen_at          timestamptz NOT NULL,
    PRIMARY KEY (issue_key, sprint_name)
);

-- Append-only audit beyond first/last; feeds the ScopeChanges panel.
-- Generalised over change_type so we capture SP, assignee, status churn AND mid-sprint additions in one stream.
CREATE TABLE scope_change_events (
    id            bigserial PRIMARY KEY,
    issue_key     text NOT NULL,
    sprint_name   text NOT NULL,
    change_type   text NOT NULL,                  -- 'sp' | 'assignee' | 'status' | 'added_mid_sprint'
    old_value     text,                           -- stringified old value (numeric for sp)
    new_value     text,                           -- stringified new value
    sp_delta      numeric(6,2),                   -- populated only when change_type='sp' or 'added_mid_sprint'
    detected_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scope_events_sprint_idx ON scope_change_events (sprint_name);
CREATE INDEX scope_events_type_idx   ON scope_change_events (change_type, detected_at DESC);
```

## DDL — comments (synced in Phase 1, displayed in v2)

Sync covers comment metadata + body in Phase 1 to honour the "all Jira pulling done by Phase 1" principle. Display, write-back, and AI features build on this foundation in v2/v3 without revisiting the sync engine.

```sql
CREATE TABLE comments (
    comment_id     text PRIMARY KEY,                 -- Jira comment ID
    issue_key      text NOT NULL REFERENCES issues(issue_key) ON DELETE CASCADE,
    author_id      text REFERENCES people(account_id),
    body_text      text NOT NULL,                    -- ADF rendered to plaintext
    body_adf       jsonb,                            -- original ADF for write-back / faithful render
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL,
    local_origin   boolean NOT NULL DEFAULT false,   -- true = posted from team-lens (v2 use)
    last_seen_at   timestamptz NOT NULL DEFAULT now(),
    removed_at     timestamptz                       -- soft delete via full scan
);
CREATE INDEX comments_issue_idx       ON comments (issue_key) WHERE removed_at IS NULL;
CREATE INDEX comments_author_idx      ON comments (author_id, created_at DESC) WHERE removed_at IS NULL;
CREATE INDEX comments_created_idx     ON comments (created_at DESC);
```

## DDL — local-only tables (never synced from Jira)

```sql
-- Public holidays for working-day computation (per-region in case team goes multi-region).
CREATE TABLE holidays (
    holiday_date  date NOT NULL,
    region        text NOT NULL DEFAULT 'IN',
    name          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (holiday_date, region)
);
CREATE INDEX holidays_date_idx ON holidays (holiday_date);

-- Team leaves. First-class capability: feeds velocity + serves as standalone team-availability tracker.
CREATE TABLE leaves (
    id                 bigserial PRIMARY KEY,
    person_account_id  text NOT NULL REFERENCES people(account_id),
    start_date         date NOT NULL,
    end_date           date NOT NULL,
    reason             text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);
CREATE INDEX leaves_person_idx ON leaves (person_account_id);
CREATE INDEX leaves_dates_idx  ON leaves (start_date, end_date);

-- Local-only settings (never synced to/from Jira). v2 use case: hidden project list.
CREATE TABLE local_settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Example rows seeded on first install:
--   ('team_region', '"IN"')
--   ('hidden_projects', '[]')
--   ('user_focus_areas', '{"keywords": ["search", "ranking"]}')
```

## DDL — sync audit

```sql
CREATE TABLE sync_runs (
    id                bigserial PRIMARY KEY,
    started_at        timestamptz NOT NULL DEFAULT now(),
    finished_at       timestamptz,
    status            text NOT NULL,                -- running|success|failed
    scan_type         text NOT NULL,                -- incremental|full
    trigger           text NOT NULL,                -- scheduled|manual
    issues_seen       int DEFAULT 0,
    issues_inserted   int DEFAULT 0,
    issues_updated    int DEFAULT 0,
    issues_removed    int DEFAULT 0,                -- only meaningful for full scans
    sp_changes        int DEFAULT 0,
    assignee_changes  int DEFAULT 0,
    status_changes    int DEFAULT 0,
    error_message     text
);
CREATE INDEX sync_runs_started_idx ON sync_runs (started_at DESC);
CREATE INDEX sync_runs_success_idx ON sync_runs (finished_at DESC) WHERE status = 'success';
```

## DDL — project archive (Phase 5 / v2-A use; populated by sync-time freeze job)

```sql
-- Closed-project stats archive — read by /projects/monitoring for historical comparison.
CREATE TABLE project_snapshots (
    project_name        text PRIMARY KEY,           -- the bit after "proj_"
    completed_at        timestamptz NOT NULL,       -- when last epic closed
    epic_count          int NOT NULL,
    epic_keys           text[] NOT NULL,            -- for drill-in / verification
    total_sp            numeric(8,2) NOT NULL,
    sprints_active      int NOT NULL,               -- distinct sprints with project work
    first_sprint_name   text,
    last_sprint_name    text,
    avg_velocity_sp     numeric(8,2),               -- SP/sprint averaged across active sprints
    avg_sprint_length_d numeric(5,2),               -- days
    scope_churn_pct     numeric(5,2),               -- |sum(sp_delta)| / total_sp × 100
    sp_added_total      numeric(8,2),               -- positive deltas
    sp_removed_total    numeric(8,2),               -- absolute value of negative deltas
    contributors        text[],                     -- account_ids who closed any work
    initiative_keys     text[],                     -- distinct initiatives the epics rolled up to
    raw_metrics         jsonb NOT NULL,             -- full rollup for any metric the UI later wants
    snapshot_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_snapshots_completed_idx ON project_snapshots (completed_at DESC);
```

## Working-days computation

Used by velocity / available-days. Defined in Postgres for clarity; also implementable in Python:

```
available_days(person, sprint) =
    weekday_count(sprint.start_date, sprint.end_date)
  - count(rows in `holidays` where holiday_date BETWEEN sprint.start_date AND sprint.end_date AND region = local_settings.team_region)
  - count(weekday days in `leaves` rows for person overlapping sprint range)
```

Floor at 1 to avoid div-by-zero in velocity.
