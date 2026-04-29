/**
 * team-lens: Sprint Health — refresh pipeline.
 *
 * refreshFromJira() is wired to the Sheet menu. It:
 *   1. Reads Config and the external Leave sheet.
 *   2. Discovers the Story Points and Sprint custom field IDs.
 *   3. Pulls tickets from the current Search sprint and the last-6 Search
 *      sprints via a single team-filtered JQL.
 *   4. Harvests sprint metadata (name/state/startDate/endDate) from the
 *      tickets' sprint arrays — no separate board API call needed.
 *   5. Runs snapshot-diff against the persisted TicketState tab to produce
 *      ScopeChanges (SP edits between runs) while upserting state.
 *   6. Aggregates per-person × per-sprint SP committed / completed /
 *      velocity / commitment-accuracy, carry-over, and epic contribution.
 *   7. Replaces the relevant tabs, appends to ScopeChanges and RunLog.
 *
 * Design rationale for snapshot-diff over changelog parsing lives in
 * docs/sprint-health-design.md → "Snapshot-diff vs. changelog parsing".
 */

const DONE_CATEGORY = 'Done';
const IN_PROGRESS_CATEGORY = 'In Progress';

function refreshFromJira() {
  const ui = SpreadsheetApp.getUi();
  const t0 = Date.now();
  const nowIso = new Date().toISOString();

  try {
    const cfg = readConfig_();
    validateConfig_(cfg);

    const spField = getCustomFieldId(['Story Points', 'Story point estimate']);
    const sprintField = getCustomFieldId(['Sprint']);

    const leave = readLeave_(cfg);

    const tickets = fetchTickets_(cfg, spField, sprintField);
    if (tickets.length === 0) {
      logRun_('ok', 0, 0, 0, leave.mismatches.length, '', 0, 0, 0, 'No tickets matched filters');
      ui.alert('Refresh complete, but no tickets matched. Check Config.team_id and sprint_name_prefix.');
      return;
    }

    const sprintRegistry = buildSprintRegistry_(tickets, cfg);
    const state = loadTicketState_();

    const scopeNewRows = [];
    const stateUpserts = diffAndUpsertState_(tickets, sprintRegistry, state, nowIso, scopeNewRows, cfg);

    const agg = aggregate_(tickets, sprintRegistry, state, leave, cfg);

    // Flag Leave-sheet names that don't match any Jira assignee we saw.
    // Surfaces typos on the next run rather than silently zero-ing leave days.
    const jiraAssignees = new Set(tickets.map(t => t.assignee).filter(Boolean));
    for (const name of leave.byPerson.keys()) {
      if (!jiraAssignees.has(name)) leave.mismatches.push(name);
    }

    writeTickets_(tickets);
    writeTicketState_(stateUpserts);
    writeSprints_(agg.sprintRows);
    writeVelocity_(agg.velocityRows);
    writeCarryOver_(agg.carryOverRows);
    writeBlockers_(agg.blockerRows);
    writeEpicContribution_(agg.epicContributionRows);
    writeSprintProgress_(agg.sprintProgressRows);
    appendScopeChanges_(scopeNewRows);

    const activeSprintName = (sprintRegistry.active[0] && sprintRegistry.active[0].name) || '';
    const hygiene = computeHygiene_(tickets, sprintRegistry, activeSprintName);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    logRun_('ok', tickets.length, agg.velocityRows.length, scopeNewRows.length,
      leave.mismatches.length, activeSprintName,
      hygiene.unassigned, hygiene.nosp, hygiene.noepic, '');
    ui.alert(
      'Refresh complete.\n\n' +
      'Tickets: ' + tickets.length + '\n' +
      'Sprints tracked: ' + sprintRegistry.ordered.length + '\n' +
      'Velocity rows: ' + agg.velocityRows.length + '\n' +
      'Scope changes (new): ' + scopeNewRows.length + '\n' +
      'Leave name mismatches: ' + leave.mismatches.length + '\n' +
      'Time: ' + secs + 's'
    );
  } catch (e) {
    logRun_('error', 0, 0, 0, 0, '', 0, 0, 0, e.message);
    ui.alert('Refresh failed.\n\n' + e.message);
    throw e;
  }
}

/* --- config ---------------------------------------------------------- */

function readConfig_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sheet) throw new Error('Config sheet missing. Run "Initialize Sheet".');
  const lastRow = sheet.getLastRow();
  const rows = sheet.getRange(2, 1, Math.max(lastRow - 1, 0), 2).getValues();
  const cfg = {};
  for (const [k, v] of rows) {
    if (k !== '' && k != null) cfg[String(k).trim()] = v;
  }
  return cfg;
}

function validateConfig_(cfg) {
  const required = ['team_id', 'jira_base_url'];
  for (const k of required) {
    if (cfg[k] === '' || cfg[k] == null) {
      throw new Error('Config.' + k + ' is empty. Fill it in on the Config tab.');
    }
  }
}

/* --- leave ----------------------------------------------------------- */

/**
 * Read the external Leave sheet into an array keyed by person.
 * Returns { byPerson: Map<name, [{start, end}]>, mismatches: string[] }.
 * mismatches accumulates names we couldn't find among Jira assignees in
 * the current pull — surfaced in RunLog so typos become visible.
 * Columns expected (case-insensitive): person, start_date, end_date (optional).
 * If end_date is blank, treat as a single-day leave.
 */
function readLeave_(cfg) {
  const empty = { byPerson: new Map(), mismatches: [] };
  const sheetId = cfg.leave_sheet_id;
  if (!sheetId) return empty;

  let ss;
  try {
    ss = SpreadsheetApp.openById(String(sheetId).trim());
  } catch (e) {
    console.warn('Leave sheet unreachable (' + e.message + '); treating leave as empty.');
    return empty;
  }
  const tabName = cfg.leave_sheet_tab || 'Leave';
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    console.warn('Leave tab "' + tabName + '" not found; treating leave as empty.');
    return empty;
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return empty;

  const header = data[0].map(h => String(h).trim().toLowerCase());
  const iPerson = header.indexOf('person');
  const iStart = header.indexOf('start_date');
  const iEnd = header.indexOf('end_date');
  if (iPerson < 0 || iStart < 0) {
    console.warn('Leave sheet missing person/start_date columns; skipping.');
    return empty;
  }

  const byPerson = new Map();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const person = String(row[iPerson] || '').trim();
    if (!person) continue;
    const start = toDate_(row[iStart]);
    if (!start) continue;
    const end = (iEnd >= 0 && row[iEnd]) ? toDate_(row[iEnd]) : start;
    if (!end) continue;
    if (!byPerson.has(person)) byPerson.set(person, []);
    byPerson.get(person).push({ start: start, end: end });
  }
  return { byPerson: byPerson, mismatches: [] };
}

/* --- fetch ----------------------------------------------------------- */

/**
 * Pull the whole ticket set in one JQL: all tickets on the team that are
 * in an open sprint OR were in one of the last-6 closed sprints. Last-6
 * sprint IDs come from Config.sprint_ids_last6 if set, otherwise they
 * are auto-resolved from the team's scrum board via the Agile API.
 * One search call is cheaper than N sprint-by-sprint calls; the aggregator
 * routes tickets into per-sprint rollups from the sprint field in memory.
 */
function fetchTickets_(cfg, spField, sprintField) {
  let last6Ids = String(cfg.sprint_ids_last6 || '').trim();
  if (last6Ids) {
    last6Ids = last6Ids.split(',').map(s => s.trim()).filter(Boolean).join(',');
  }
  if (!last6Ids) {
    last6Ids = autoResolveLast6SprintIds_(cfg, sprintField);
  }

  const clauses = ['cf[10500] = "' + cfg.team_id + '"'];
  const inOpen = 'sprint in openSprints()';
  if (last6Ids) {
    clauses.push('(' + inOpen + ' OR sprint in (' + last6Ids + '))');
  } else {
    clauses.push(inOpen);
  }
  const jql = clauses.join(' AND ');

  const fields = [
    'summary', 'status', 'issuetype', 'assignee', 'created', 'updated',
    'resolutiondate', 'parent', spField, sprintField
  ];
  const issues = searchJql(jql, fields);
  return issues.map(i => {
    const f = i.fields || {};
    const spRaw = f[spField];
    return {
      key: i.key,
      parent_epic_key: (f.parent && f.parent.key) || '',
      summary: f.summary || '',
      issuetype: (f.issuetype && f.issuetype.name) || '',
      status: (f.status && f.status.name) || '',
      status_category: (f.status && f.status.statusCategory && f.status.statusCategory.name) || '',
      story_points: (spRaw == null) ? null : Number(spRaw),
      assignee: (f.assignee && f.assignee.displayName) || '',
      created: f.created || '',
      updated: f.updated || '',
      resolutiondate: f.resolutiondate || '',
      sprints: Array.isArray(f[sprintField]) ? f[sprintField] : []
    };
  });
}

/* --- auto-resolve last-6 sprint IDs ---------------------------------- */

/**
 * Without an explicit Config.sprint_ids_last6, we miss tickets that closed
 * inside a past sprint and never carried over — they fall out of
 * `sprint in openSprints()`. To fix that automatically, we:
 *   1. Do a small pre-fetch of any active-sprint ticket to discover the
 *      scrum board's `boardId` from its sprint object.
 *   2. Page through `/rest/agile/1.0/board/{boardId}/sprint?state=closed`
 *      to get every closed sprint the board has ever run.
 *   3. Filter by Config.sprint_name_prefix, sort by endDate descending,
 *      keep the 6 most recent and return them as a comma-separated id
 *      string to be dropped into the main JQL.
 *
 * Returns '' if the board can't be derived or the Agile API call fails —
 * falls back to openSprints()-only (same behaviour as before).
 */
function autoResolveLast6SprintIds_(cfg, sprintField) {
  try {
    const sample = jiraPost('/rest/api/3/search/jql', {
      jql: 'cf[10500] = "' + cfg.team_id + '" AND sprint in openSprints()',
      fields: [sprintField],
      maxResults: 5
    });
    if (!sample.issues || !sample.issues.length) {
      console.warn('autoResolveLast6SprintIds_: no active-sprint ticket — cannot derive boardId');
      return '';
    }

    // Pick the first active sprint we can find on any sampled ticket;
    // its boardId identifies the team's scrum board.
    let boardId = null;
    const prefix = String(cfg.sprint_name_prefix || '');
    for (const issue of sample.issues) {
      const sprints = (issue.fields && issue.fields[sprintField]) || [];
      const match = sprints.find(s =>
        s && s.state === 'active' && s.boardId &&
        (!prefix || (s.name && s.name.indexOf(prefix) === 0))
      );
      if (match) { boardId = match.boardId; break; }
    }
    if (!boardId) {
      console.warn('autoResolveLast6SprintIds_: no boardId on any active sprint');
      return '';
    }

    const all = fetchClosedSprintsForBoard_(boardId);
    const filtered = all
      .filter(s => !prefix || (s.name && s.name.indexOf(prefix) === 0))
      .filter(s => s.endDate)
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())
      .slice(0, 6);

    const ids = filtered.map(s => s.id).join(',');
    console.log('Auto-resolved last-6 sprint IDs from board ' + boardId + ': [' + ids + '] (' +
      filtered.map(s => s.name).join(', ') + ')');
    return ids;
  } catch (e) {
    console.warn('autoResolveLast6SprintIds_ failed: ' + e.message + ' — falling back to openSprints() only');
    return '';
  }
}

/**
 * Paginate /rest/agile/1.0/board/{id}/sprint?state=closed and return every
 * sprint. Sprint counts accumulate over years — hundreds is common — but
 * pagination is cheap and we run this at most once per refresh.
 */
function fetchClosedSprintsForBoard_(boardId) {
  const all = [];
  let startAt = 0;
  const maxPages = 20;
  for (let page = 0; page < maxPages; page++) {
    const resp = jiraGet('/rest/agile/1.0/board/' + boardId +
      '/sprint?state=closed&maxResults=50&startAt=' + startAt);
    const values = resp.values || [];
    for (const s of values) all.push(s);
    if (resp.isLast || values.length === 0) break;
    startAt += values.length;
  }
  return all;
}

/* --- sprint registry ------------------------------------------------- */

/**
 * Collect sprint metadata from the tickets' sprint arrays.
 * Only sprints whose name starts with cfg.sprint_name_prefix and whose
 * state is not 'future' are kept. Ordered chronologically by endDate.
 */
function buildSprintRegistry_(tickets, cfg) {
  const prefix = String(cfg.sprint_name_prefix || '');
  const byName = new Map();
  for (const t of tickets) {
    for (const s of t.sprints) {
      if (!s || !s.name) continue;
      if (prefix && s.name.indexOf(prefix) !== 0) continue;
      if (s.state === 'future') continue;
      if (!byName.has(s.name)) {
        byName.set(s.name, {
          name: s.name,
          state: s.state || '',
          startDate: s.startDate || '',
          endDate: s.endDate || ''
        });
      }
    }
  }
  const ordered = Array.from(byName.values())
    .sort((a, b) => endOrStart_(a) - endOrStart_(b));
  const active = ordered.filter(s => s.state === 'active');
  const closed = ordered.filter(s => s.state !== 'active').slice(-6);
  const tracked = closed.concat(active);  // oldest closed … newest active
  const trackedSet = new Set(tracked.map(s => s.name));
  return {
    byName: byName,
    ordered: tracked,
    trackedSet: trackedSet,
    active: active
  };
}

function endOrStart_(s) {
  return new Date(s.endDate || s.startDate || 0).getTime();
}

/* --- state diff ------------------------------------------------------ */

function loadTicketState_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('TicketState');
  if (!sheet) throw new Error('TicketState tab missing. Run "Initialize Sheet".');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Map();
  const rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const map = new Map();
  for (const r of rows) {
    const [ticket, sprintName, firstSp, lastSp, lastAssignee, lastStatus, firstSeen, lastSeen] = r;
    if (!ticket || !sprintName) continue;
    map.set(stateKey_(ticket, sprintName), {
      ticket_key: String(ticket),
      sprint_name: String(sprintName),
      first_sp: (firstSp === '' ? null : Number(firstSp)),
      last_sp: (lastSp === '' ? null : Number(lastSp)),
      last_assignee: String(lastAssignee || ''),
      last_status: String(lastStatus || ''),
      first_seen_iso: String(firstSeen || ''),
      last_seen_iso: String(lastSeen || '')
    });
  }
  return map;
}

function stateKey_(ticket, sprintName) {
  return ticket + '|' + sprintName;
}

/**
 * Diff current ticket SP against TicketState.last_sp for every
 * (ticket, sprint) pairing the ticket belongs to among tracked sprints.
 * Mutates `state` in place and returns a fresh array of rows to write
 * back to the TicketState tab. First sightings are silent (baseline seed).
 */
function diffAndUpsertState_(tickets, sprintRegistry, state, nowIso, scopeNewRows, cfg) {
  for (const t of tickets) {
    const currentSp = numOrNull_(t.story_points);
    for (const s of t.sprints) {
      if (!s || !s.name || !sprintRegistry.trackedSet.has(s.name)) continue;
      const key = stateKey_(t.key, s.name);
      const prev = state.get(key);
      if (!prev) {
        state.set(key, {
          ticket_key: t.key,
          sprint_name: s.name,
          first_sp: currentSp,
          last_sp: currentSp,
          last_assignee: t.assignee,
          last_status: t.status,
          first_seen_iso: nowIso,
          last_seen_iso: nowIso
        });
        continue;
      }
      const spChanged = !numEq_(prev.last_sp, currentSp);
      const sprintStarted = sprintHasStarted_(sprintRegistry.byName.get(s.name));
      if (spChanged && sprintStarted) {
        const before = prev.last_sp;
        const after = currentSp;
        const delta = (after == null || before == null) ? null : (after - before);
        const baseline = prev.first_sp;
        const pct = (baseline && baseline !== 0 && delta != null)
          ? (delta / baseline) : null;
        scopeNewRows.push([
          nowIso,
          t.key,
          t.assignee,
          s.name,
          (before == null ? '' : before),
          (after == null ? '' : after),
          (delta == null ? '' : delta),
          (pct == null ? '' : round2_(pct))
        ]);
      }
      prev.last_sp = currentSp;
      prev.last_assignee = t.assignee;
      prev.last_status = t.status;
      prev.last_seen_iso = nowIso;
      if (prev.first_sp == null && currentSp != null) prev.first_sp = currentSp;
    }
  }
  const rows = [];
  for (const v of state.values()) {
    rows.push([
      v.ticket_key, v.sprint_name,
      (v.first_sp == null ? '' : v.first_sp),
      (v.last_sp == null ? '' : v.last_sp),
      v.last_assignee, v.last_status,
      v.first_seen_iso, v.last_seen_iso
    ]);
  }
  return rows;
}

function sprintHasStarted_(s) {
  if (!s || !s.startDate) return false;
  return new Date(s.startDate).getTime() <= Date.now();
}

/* --- aggregate ------------------------------------------------------- */

/**
 * Build Sprints × Velocity × CarryOver × EpicContribution rows from the
 * in-memory ticket set and the per-sprint TicketState baseline.
 *
 * Per (person, sprint):
 *   sp_committed   = sum of TicketState.first_sp for tickets in that sprint
 *                    whose current assignee matches (approximation — we
 *                    don't track historical assignee per sprint boundary).
 *   sp_completed   = sum of SP on tickets with resolutiondate inside the
 *                    sprint window, whose sprint field includes that sprint.
 *   leave_days     = count of weekdays within the sprint window where the
 *                    person has a Leave entry.
 *   available_days = working_days_default − leave_days (min 1 to avoid div0).
 */
function aggregate_(tickets, sprintRegistry, state, leave, cfg) {
  const workingDaysDefault = Number(cfg.sprint_working_days_default) || 10;

  // Ticket → list of tracked sprints it belongs to.
  const trackedSprintsForTicket = new Map();
  for (const t of tickets) {
    const names = t.sprints
      .filter(s => s && s.name && sprintRegistry.trackedSet.has(s.name))
      .map(s => s.name);
    if (names.length) trackedSprintsForTicket.set(t.key, names);
  }

  // Accumulators keyed by `person|sprint_name`.
  const rollup = new Map();
  const ensure = (person, sprint) => {
    const key = person + '|' + sprint;
    if (!rollup.has(key)) {
      rollup.set(key, { person: person, sprint: sprint, sp_committed: 0, sp_completed: 0 });
    }
    return rollup.get(key);
  };

  // sp_committed: iterate TicketState baselines.
  for (const v of state.values()) {
    if (!sprintRegistry.trackedSet.has(v.sprint_name)) continue;
    const person = v.last_assignee || '';
    if (!person) continue;
    const baseline = numOrZero_(v.first_sp);
    if (baseline === 0) continue;
    ensure(person, v.sprint_name).sp_committed += baseline;
  }

  // sp_completed: closed-in-sprint.
  for (const t of tickets) {
    if (t.status_category !== DONE_CATEGORY) continue;
    if (!t.resolutiondate || !t.assignee) continue;
    const resTs = new Date(t.resolutiondate).getTime();
    const names = trackedSprintsForTicket.get(t.key) || [];
    for (const name of names) {
      const sprint = sprintRegistry.byName.get(name);
      if (!sprint) continue;
      if (!ticketClosedInSprint_(resTs, sprint)) continue;
      const sp = numOrZero_(t.story_points);
      if (sp === 0) continue;
      ensure(t.assignee, name).sp_completed += sp;
      break;  // attribute a closed ticket to one sprint only
    }
  }

  // Materialise Sprints × person rows with leave adjustment.
  const sprintRows = [];
  for (const r of rollup.values()) {
    const sprint = sprintRegistry.byName.get(r.sprint);
    const leaveDays = leaveDaysForPersonInSprint_(leave.byPerson, r.person, sprint);
    const availableDays = Math.max(workingDaysDefault - leaveDays, 1);
    sprintRows.push([
      r.sprint, r.person,
      r.sp_committed, r.sp_completed,
      workingDaysDefault, leaveDays, availableDays
    ]);
    r.working_days = workingDaysDefault;
    r.leave_days = leaveDays;
    r.available_days = availableDays;
  }

  // Velocity rows with per-person prior-3 comparison.
  const perPerson = new Map();
  const sprintOrder = sprintRegistry.ordered.map(s => s.name);
  const sprintIndex = new Map(sprintOrder.map((n, i) => [n, i]));
  for (const r of rollup.values()) {
    if (!perPerson.has(r.person)) perPerson.set(r.person, []);
    perPerson.get(r.person).push(r);
  }
  for (const list of perPerson.values()) {
    list.sort((a, b) => (sprintIndex.get(a.sprint) || 0) - (sprintIndex.get(b.sprint) || 0));
  }

  const velocityRows = [];
  for (const [person, list] of perPerson) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const velocity = r.available_days > 0 ? r.sp_completed / r.available_days : 0;
      const accuracy = r.sp_committed > 0 ? r.sp_completed / r.sp_committed : null;
      const priorSlice = list.slice(Math.max(0, i - 3), i);
      const priorAvgVelocity = priorSlice.length
        ? priorSlice.reduce((s, x) => s + (x.available_days > 0 ? x.sp_completed / x.available_days : 0), 0) / priorSlice.length
        : 0;
      const velocityRatio = priorAvgVelocity > 0 ? velocity / priorAvgVelocity : null;
      velocityRows.push([
        person, r.sprint,
        r.sp_committed, r.sp_completed,
        r.working_days, r.leave_days, r.available_days,
        round2_(velocity),
        accuracy == null ? '' : round2_(accuracy),
        flagRatio_(velocityRatio, cfg.threshold_velocity_yellow, cfg.threshold_velocity_red, true),
        flagRatio_(accuracy, cfg.threshold_accuracy_yellow, cfg.threshold_accuracy_red, true)
      ]);
    }
  }

  // CarryOver: non-Done tickets whose tracked-sprint count ≥ yellow threshold
  // AND which are still currently assigned to the active sprint. Tickets
  // that were pulled out of the active sprint (moved to backlog or a future
  // sprint) stop being "carry-over" even if they spanned multiple past
  // sprints — they're no longer carrying. This filter drops false positives
  // like tickets moved out before the active sprint started.
  const activeSprintName = (sprintRegistry.active[0] && sprintRegistry.active[0].name) || '';
  const carryYellow = Number(cfg.threshold_carryover_yellow_sprints) || 2;
  const carryOverRows = [];
  for (const t of tickets) {
    if (t.status_category === DONE_CATEGORY) continue;
    // Sub-tasks are excluded from carry-over: they carry no Story Points on
    // this tenant, so a "3 SP carry-over" row for a sub-task would be
    // misleading. Their blocker signal is captured by the Blockers panel.
    if (t.issuetype === 'Sub-task') continue;
    const names = trackedSprintsForTicket.get(t.key) || [];
    const depth = names.length;
    if (depth < carryYellow) continue;
    if (!activeSprintName || names.indexOf(activeSprintName) === -1) continue;
    // original_sp = earliest first_sp observed across this ticket's sprints.
    let originalSp = null;
    for (const n of names) {
      const v = state.get(stateKey_(t.key, n));
      if (v && v.first_sp != null) {
        if (originalSp == null) originalSp = v.first_sp;
      }
    }
    carryOverRows.push([
      t.key, t.assignee, depth, t.status,
      originalSp == null ? '' : originalSp,
      t.story_points == null ? '' : t.story_points,
      t.summary
    ]);
  }
  carryOverRows.sort((a, b) => b[2] - a[2]);

  // Blockers: open sub-tasks in the active sprint, with age = days since
  // `updated`. Mirrors the Jira dashboard's aging-subtasks panel so the
  // web page can show the same signal offline. `updated` is a reasonable
  // proxy for "last transition date" — exact transition history would
  // need per-ticket changelog, which we deliberately don't query.
  const now = new Date();
  const blockerYellow = Number(cfg.threshold_blocker_age_yellow_days) || 3;
  const blockerRed = Number(cfg.threshold_blocker_age_red_days) || 7;
  const blockerRows = [];
  for (const t of tickets) {
    if (t.issuetype !== 'Sub-task') continue;
    if (t.status_category === DONE_CATEGORY) continue;
    const names = trackedSprintsForTicket.get(t.key) || [];
    if (!activeSprintName || names.indexOf(activeSprintName) === -1) continue;
    const ageDays = t.updated
      ? Math.floor((now.getTime() - new Date(t.updated).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const band = ageDays >= blockerRed ? 'red' : ageDays >= blockerYellow ? 'yellow' : 'green';
    blockerRows.push([
      t.key,
      t.parent_epic_key || '',
      t.assignee || '',
      t.status || '',
      t.updated || '',
      ageDays,
      band,
      t.summary || ''
    ]);
  }
  blockerRows.sort((a, b) => b[5] - a[5]);  // oldest first

  // EpicContribution: Done SP per (person, epic).
  const epicAcc = new Map();
  for (const t of tickets) {
    if (t.status_category !== DONE_CATEGORY) continue;
    if (!t.assignee || !t.parent_epic_key) continue;
    const sp = numOrZero_(t.story_points);
    if (sp === 0) continue;
    const k = t.assignee + '|' + t.parent_epic_key;
    epicAcc.set(k, (epicAcc.get(k) || 0) + sp);
  }
  const epicContributionRows = [];
  for (const [k, sp] of epicAcc) {
    const [person, epic] = k.split('|');
    epicContributionRows.push([person, epic, sp]);
  }
  epicContributionRows.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));

  // Per-person SP breakdown by status bucket, active sprint only. Closed
  // sprints can't be bucketed retroactively (we only have current state,
  // not historical), so their velocity rows emit '' here and the web page
  // falls back to the solid progress bar for closed views.
  const bucketByPerson = new Map();
  if (activeSprintName) {
    for (const t of tickets) {
      const names = trackedSprintsForTicket.get(t.key) || [];
      if (names.indexOf(activeSprintName) === -1) continue;
      if (!t.assignee) continue;
      const sp = numOrZero_(t.story_points);
      if (sp === 0) continue;
      if (!bucketByPerson.has(t.assignee)) {
        bucketByPerson.set(t.assignee,
          { done: 0, validation: 0, review: 0, in_progress: 0, todo: 0 });
      }
      bucketByPerson.get(t.assignee)[bucketStatus_(t.status_category, t.status)] += sp;
    }
  }
  // Stitch sp_by_status JSON into each active-sprint velocity row. This
  // mutates velocityRows in place — safer than threading through earlier
  // because the sp_by_status value is derived per-person, not per-sprint-row.
  for (const row of velocityRows) {
    const [person, sprint] = row;
    if (sprint === activeSprintName && bucketByPerson.has(person)) {
      row.push(JSON.stringify(bucketByPerson.get(person)));
    } else {
      row.push('');
    }
  }

  // Burnup for the active sprint: per-(date, person) cumulative SP closed.
  // Source: resolutiondate on each Done ticket. No daily snapshot or changelog
  // needed — resolutiondate is the authoritative close timestamp. Dates span
  // sprint start to min(sprint end, today) so we never show future zeros.
  const sprintProgressRows = [];
  if (activeSprintName) {
    const s = sprintRegistry.byName.get(activeSprintName);
    if (s && s.startDate) {
      const sprintStart = new Date(s.startDate);
      const sprintEnd = s.endDate ? new Date(s.endDate) : null;
      const today = new Date();
      const lastDay = (sprintEnd && sprintEnd.getTime() < today.getTime()) ? sprintEnd : today;

      const doneByPerson = new Map();  // person -> [{ts, sp}]
      for (const t of tickets) {
        if (t.status_category !== DONE_CATEGORY) continue;
        if (!t.resolutiondate || !t.assignee) continue;
        const names = trackedSprintsForTicket.get(t.key) || [];
        if (names.indexOf(activeSprintName) === -1) continue;
        const resTs = new Date(t.resolutiondate).getTime();
        if (resTs < sprintStart.getTime()) continue;
        if (sprintEnd && resTs > sprintEnd.getTime()) continue;
        const sp = numOrZero_(t.story_points);
        if (sp === 0) continue;
        if (!doneByPerson.has(t.assignee)) doneByPerson.set(t.assignee, []);
        doneByPerson.get(t.assignee).push({ ts: resTs, sp: sp });
      }
      for (const arr of doneByPerson.values()) arr.sort((a, b) => a.ts - b.ts);

      // People to emit lines for = anyone in the active sprint (via rollup)
      // plus anyone with done work (caught above). Emitting flat-zero lines
      // for people who've closed nothing is deliberate — it surfaces stalls.
      const people = new Set();
      for (const key of rollup.keys()) {
        const parts = key.split('|');
        if (parts[1] === activeSprintName) people.add(parts[0]);
      }
      for (const p of doneByPerson.keys()) people.add(p);

      const day = new Date(sprintStart);
      day.setHours(23, 59, 59, 999);
      const lastTs = new Date(lastDay);
      lastTs.setHours(23, 59, 59, 999);
      while (day.getTime() <= lastTs.getTime()) {
        const dateStr = Utilities.formatDate(day, 'UTC', 'yyyy-MM-dd');
        const dayTs = day.getTime();
        for (const person of people) {
          const closings = doneByPerson.get(person) || [];
          let cumSp = 0;
          for (const c of closings) {
            if (c.ts <= dayTs) cumSp += c.sp;
            else break;
          }
          sprintProgressRows.push([dateStr, person, cumSp]);
        }
        day.setDate(day.getDate() + 1);
      }
    }
  }

  return { sprintRows, velocityRows, carryOverRows, blockerRows, epicContributionRows, sprintProgressRows };
}

/**
 * Map a Jira (statusCategory, statusName) pair to one of the five pipeline
 * buckets the web page uses for its segmented progress bar. Category is
 * Jira's normalized coarse state; name is used to sub-bucket 'In Progress'
 * into review/validation/in-progress based on free-text workflow names.
 */
function bucketStatus_(category, statusName) {
  if (category === DONE_CATEGORY) return 'done';
  if (category !== IN_PROGRESS_CATEGORY) return 'todo';
  const s = String(statusName || '').toLowerCase();
  if (s.indexOf('validation') !== -1 || s.indexOf('qa') !== -1 ||
      s.indexOf('uat') !== -1 || s.indexOf('test') !== -1) return 'validation';
  if (s.indexOf('review') !== -1) return 'review';
  return 'in_progress';
}

function ticketClosedInSprint_(resTs, sprint) {
  if (!sprint.startDate || !sprint.endDate) return false;
  const s = new Date(sprint.startDate).getTime();
  const e = new Date(sprint.endDate).getTime();
  return resTs >= s && resTs <= e;
}

function leaveDaysForPersonInSprint_(byPerson, person, sprint) {
  if (!sprint || !sprint.startDate || !sprint.endDate) return 0;
  const entries = byPerson.get(person);
  if (!entries || entries.length === 0) return 0;
  const start = new Date(sprint.startDate);
  const end = new Date(sprint.endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  let days = 0;
  for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays_(d, 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;  // skip weekends
    for (const { start: ls, end: le } of entries) {
      if (d.getTime() >= startOfDay_(ls).getTime() && d.getTime() <= endOfDay_(le).getTime()) {
        days++;
        break;
      }
    }
  }
  return days;
}

/* --- flags ----------------------------------------------------------- */

function flagRatio_(ratio, yellow, red, higherIsBetter) {
  if (ratio == null || isNaN(ratio)) return '—';
  const y = Number(yellow), r = Number(red);
  if (higherIsBetter) {
    if (ratio >= y) return '🟢';
    if (ratio >= r) return '🟡';
    return '🔴';
  }
  if (ratio < y) return '🟢';
  if (ratio < r) return '🟡';
  return '🔴';
}

/* --- writes ---------------------------------------------------------- */

const TICKETS_HEADER = [
  'ticket_key', 'parent_epic_key', 'summary', 'issuetype', 'status',
  'story_points', 'assignee', 'created', 'updated', 'resolutiondate',
  'sprint'
];

const TICKET_STATE_HEADER = [
  'ticket_key', 'sprint_name', 'first_sp', 'last_sp',
  'last_assignee', 'last_status', 'first_seen_iso', 'last_seen_iso'
];

const SPRINTS_HEADER = [
  'sprint_name', 'person', 'sp_committed', 'sp_completed',
  'working_days', 'leave_days', 'available_days'
];

const VELOCITY_HEADER = [
  'person', 'sprint', 'sp_committed', 'sp_completed',
  'working_days', 'leave_days', 'available_days',
  'velocity', 'commitment_accuracy',
  'flag_velocity_drop', 'flag_accuracy_drop',
  'sp_by_status'
];

const CARRY_OVER_HEADER = [
  'ticket_key', 'assignee', 'depth_sprints', 'status',
  'original_sp', 'current_sp', 'summary'
];

const EPIC_CONTRIBUTION_HEADER = [
  'person', 'epic_key', 'sp_done'
];

const BLOCKERS_HEADER = [
  'ticket_key', 'parent_epic_key', 'assignee', 'status',
  'updated', 'age_days', 'age_band', 'summary'
];

const SPRINT_PROGRESS_HEADER = [
  'date', 'person', 'sp_done_cumulative'
];

const SCOPE_CHANGES_HEADER = [
  'detected_at', 'ticket_key', 'assignee', 'sprint',
  'sp_before', 'sp_after', 'delta', 'pct_of_baseline'
];

function writeTickets_(tickets) {
  const rows = tickets.map(t => [
    t.key, t.parent_epic_key, t.summary, t.issuetype, t.status,
    (t.story_points == null ? '' : t.story_points),
    t.assignee, t.created, t.updated, t.resolutiondate,
    t.sprints.map(s => s.name).join(', ')
  ]);
  replaceTab_('Tickets', TICKETS_HEADER, rows);
}

function writeTicketState_(rows) { replaceTab_('TicketState', TICKET_STATE_HEADER, rows); }
function writeSprints_(rows)     { replaceTab_('Sprints', SPRINTS_HEADER, rows); }
function writeVelocity_(rows)    { replaceTab_('VelocityComputed', VELOCITY_HEADER, rows); }
function writeCarryOver_(rows)   { replaceTab_('CarryOver', CARRY_OVER_HEADER, rows); }
function writeEpicContribution_(rows) { replaceTab_('EpicContribution', EPIC_CONTRIBUTION_HEADER, rows); }
function writeBlockers_(rows)         { replaceTab_('Blockers', BLOCKERS_HEADER, rows); }
function writeSprintProgress_(rows)   { replaceTab_('SprintProgressActive', SPRINT_PROGRESS_HEADER, rows); }

function appendScopeChanges_(newRows) {
  if (!newRows.length) return;
  const sheet = SpreadsheetApp.getActive().getSheetByName('ScopeChanges');
  if (!sheet) throw new Error('ScopeChanges tab missing. Run "Initialize Sheet".');
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SCOPE_CHANGES_HEADER.length).setValues([SCOPE_CHANGES_HEADER]);
    sheet.getRange(1, 1, 1, SCOPE_CHANGES_HEADER.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, SCOPE_CHANGES_HEADER.length).setValues(newRows);
}

function replaceTab_(tabName, header, rows) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sheet) throw new Error('Tab missing: ' + tabName + '. Run "Initialize Sheet".');
  sheet.clear();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
}

function logRun_(status, rowsTickets, rowsVelocity, scopeNew, leaveMismatches,
                 activeSprint, hygieneUnassigned, hygieneNoSp, hygieneNoEpic, errorMsg) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('RunLog');
  if (!sheet) return;
  sheet.appendRow([
    new Date().toISOString(),
    status,
    rowsTickets,
    rowsVelocity,
    scopeNew,
    leaveMismatches,
    activeSprint,
    hygieneUnassigned,
    hygieneNoSp,
    hygieneNoEpic,
    errorMsg
  ]);
}

/**
 * Hygiene counts for the active sprint. Sub-tasks are excluded from the
 * SP + Epic checks because on this tenant sub-tasks don't carry Story
 * Points and their parent is a Story (not an Epic), so those counts
 * would be permanently inflated if sub-tasks were included.
 */
function computeHygiene_(tickets, sprintRegistry, activeSprintName) {
  const result = { unassigned: 0, nosp: 0, noepic: 0 };
  if (!activeSprintName) return result;
  for (const t of tickets) {
    const names = (t.sprints || []).map(s => s && s.name).filter(Boolean);
    if (names.indexOf(activeSprintName) === -1) continue;
    if (!t.assignee) result.unassigned++;
    if (t.issuetype !== 'Sub-task') {
      if (t.story_points == null) result.nosp++;
      if (!t.parent_epic_key) result.noepic++;
    }
  }
  return result;
}

/* --- utils ----------------------------------------------------------- */

function numOrNull_(v) {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function numOrZero_(v) {
  const n = numOrNull_(v);
  return n == null ? 0 : n;
}

function numEq_(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function round2_(n) { return Math.round(n * 100) / 100; }

function toDate_(v) {
  if (v instanceof Date) return v;
  if (v == null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function addDays_(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfDay_(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay_(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
