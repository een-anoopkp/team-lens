/**
 * team-lens: Epic Risk — refresh pipeline.
 *
 * refreshFromJira() is wired to the Sheet menu. It:
 *   1. Reads Config.
 *   2. Discovers the Story Points and Sprint custom field IDs.
 *   3. Pulls quarter epics (JQL #1) and their child tickets (JQL #2).
 *   4. Aggregates counts, SP sums, per-sprint closed SP, and flag states.
 *   5. Replaces the Epics / EpicSprintHistory / Tickets tabs and appends a
 *      RunLog row with timing + error (if any).
 *
 * The flag_scope_explosion column is intentionally left as '—' in this
 * first cut — accurate scope-explosion detection needs per-ticket changelog
 * parsing, which is expensive and deferred. Every other flag is live.
 */

function refreshFromJira() {
  const ui = SpreadsheetApp.getUi();
  const t0 = Date.now();
  try {
    const cfg = readConfig_();
    validateConfig_(cfg);

    const spField = getCustomFieldId(['Story Points', 'Story point estimate']);
    const sprintField = getCustomFieldId(['Sprint']);

    const epics = fetchEpics_(cfg);
    if (epics.length === 0) {
      logRun_('ok', 0, 0, 'No epics matched filter');
      ui.alert('Refresh complete, but no epics matched the Config filter.\n\n' +
        'Check team_id, quarter_start, quarter_end on the Config tab.');
      return;
    }

    const tickets = fetchTickets_(epics.map(e => e.key), spField, sprintField);
    const agg = aggregate_(epics, tickets, cfg);

    writeEpics_(agg.epicRows);
    writeSprintHistory_(agg.sprintHistoryRows);
    writeTickets_(agg.ticketRows);

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    logRun_('ok', epics.length, tickets.length, '');
    ui.alert(
      'Refresh complete.\n\n' +
      'Epics: ' + epics.length + '\n' +
      'Tickets: ' + tickets.length + '\n' +
      'Sprint-history rows: ' + agg.sprintHistoryRows.length + '\n' +
      'Time: ' + secs + 's'
    );
  } catch (e) {
    logRun_('error', 0, 0, e.message);
    ui.alert('Refresh failed.\n\n' + e.message);
    throw e;  // surface in Apps Script logs too
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
  const required = ['team_id', 'quarter_start', 'quarter_end', 'jira_base_url'];
  for (const k of required) {
    if (cfg[k] === '' || cfg[k] == null) {
      throw new Error('Config.' + k + ' is empty. Fill it in on the Config tab.');
    }
  }
}

/* --- fetch ----------------------------------------------------------- */

function fetchEpics_(cfg) {
  const qStart = formatDate_(cfg.quarter_start);
  const qEnd = formatDate_(cfg.quarter_end);
  const jql =
    'cf[10500] = "' + cfg.team_id + '" ' +
    'AND issuetype = Epic ' +
    'AND ( ' +
    '(startDate >= "' + qStart + '" AND startDate <= "' + qEnd + '") ' +
    'OR ' +
    '(duedate >= "' + qStart + '" AND duedate <= "' + qEnd + '") ' +
    ')';
  const issues = searchJql(jql, ['summary', 'duedate', 'status']);
  return issues.map(i => ({
    key: i.key,
    summary: (i.fields && i.fields.summary) || '',
    duedate: (i.fields && i.fields.duedate) || '',
    status: (i.fields && i.fields.status && i.fields.status.name) || ''
  }));
}

function fetchTickets_(epicKeys, spField, sprintField) {
  if (epicKeys.length === 0) return [];
  const quoted = epicKeys.map(k => '"' + k + '"').join(',');
  const jql = 'parent in (' + quoted + ')';
  const fields = [
    'summary', 'status', 'assignee', 'created', 'updated',
    'resolutiondate', 'parent', spField, sprintField
  ];
  const issues = searchJql(jql, fields);
  return issues.map(i => {
    const f = i.fields || {};
    const spRaw = f[spField];
    return {
      key: i.key,
      epic_key: (f.parent && f.parent.key) || '',
      summary: f.summary || '',
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

/* --- aggregate ------------------------------------------------------- */

function aggregate_(epics, tickets, cfg) {
  const now = new Date();
  const byEpic = new Map();
  for (const e of epics) {
    byEpic.set(e.key, {
      epic: e,
      tickets_done: 0, tickets_in_progress: 0, tickets_to_do: 0,
      sp_done: 0, sp_in_progress: 0, sp_to_do: 0,
      // sprint_sp_closed: Map<name, { endDate: iso|'', sp: number }>
      sprint_sp_closed: new Map(),
      oldest_in_progress_days: 0,
      open_total: 0, open_unestimated: 0
    });
  }

  for (const t of tickets) {
    const a = byEpic.get(t.epic_key);
    if (!a) continue;
    const sp = typeof t.story_points === 'number' && !isNaN(t.story_points) ? t.story_points : 0;
    const hasSp = typeof t.story_points === 'number' && !isNaN(t.story_points);

    if (t.status_category === 'Done') {
      a.tickets_done++;
      a.sp_done += sp;
      const closing = pickClosingSprint_(t.sprints, t.resolutiondate);
      if (closing) {
        const prev = a.sprint_sp_closed.get(closing.name) || { endDate: closing.endDate, sp: 0 };
        prev.sp += sp;
        if (!prev.endDate && closing.endDate) prev.endDate = closing.endDate;
        a.sprint_sp_closed.set(closing.name, prev);
      }
    } else if (t.status_category === 'In Progress') {
      a.tickets_in_progress++;
      a.sp_in_progress += sp;
      a.open_total++;
      if (!hasSp) a.open_unestimated++;
      if (t.updated) {
        const ageDays = daysBetween_(new Date(t.updated), now);
        if (ageDays > a.oldest_in_progress_days) a.oldest_in_progress_days = ageDays;
      }
    } else {
      // To Do and any other not-done not-in-progress categories
      a.tickets_to_do++;
      a.sp_to_do += sp;
      a.open_total++;
      if (!hasSp) a.open_unestimated++;
    }
  }

  const epicRows = epics.map(e => {
    const a = byEpic.get(e.key);
    const sprintsOrdered = orderSprintsByEndDate_(a.sprint_sp_closed);
    const lastSp = sprintsOrdered.length
      ? (a.sprint_sp_closed.get(sprintsOrdered[sprintsOrdered.length - 1]).sp || 0)
      : 0;
    const priorSlice = sprintsOrdered.slice(-4, -1);
    const priorAvg = priorSlice.length
      ? priorSlice.reduce((s, n) => s + (a.sprint_sp_closed.get(n).sp || 0), 0) / priorSlice.length
      : 0;

    const tpRatio = priorAvg > 0 ? lastSp / priorAvg : null;
    const unestRatio = a.open_total > 0 ? a.open_unestimated / a.open_total : 0;

    return [
      e.key, e.summary, e.duedate,
      a.tickets_done, a.tickets_in_progress, a.tickets_to_do,
      a.sp_done, a.sp_in_progress, a.sp_to_do,
      lastSp, round1_(priorAvg),
      flagRatio_(tpRatio, cfg.threshold_throughput_yellow, cfg.threshold_throughput_red, true),
      '—',  // flag_scope_explosion: deferred until changelog parsing lands
      flagAge_(a.oldest_in_progress_days, cfg.threshold_no_movement_yellow_days, cfg.threshold_no_movement_red_days),
      flagRatio_(unestRatio, cfg.threshold_unestimated_yellow, cfg.threshold_unestimated_red, false)
    ];
  });

  const sprintHistoryRows = [];
  for (const a of byEpic.values()) {
    for (const [name, info] of a.sprint_sp_closed) {
      sprintHistoryRows.push([a.epic.key, name, info.endDate || '', info.sp]);
    }
  }

  const ticketRows = tickets.map(t => [
    t.key, t.epic_key, t.summary, t.status,
    (t.story_points == null ? '' : t.story_points),
    t.assignee, t.created, t.updated, t.resolutiondate,
    t.sprints.map(s => s.name).join(', ')
  ]);

  return { epicRows, sprintHistoryRows, ticketRows };
}

/**
 * Pick the sprint in which a ticket closed, returning { name, endDate }.
 * Drops future-state sprints — tickets don't close in sprints that haven't
 * started. Within the remaining set, prefers the sprint whose endDate is
 * closest to the resolution date; falls back to the last eligible sprint.
 */
function pickClosingSprint_(sprints, resolutiondateIso) {
  if (!sprints || sprints.length === 0) return null;
  const eligible = sprints.filter(s => s && s.name && s.state !== 'future');
  if (eligible.length === 0) return null;

  if (resolutiondateIso) {
    const resTs = new Date(resolutiondateIso).getTime();
    let best = null, bestDelta = Infinity;
    for (const s of eligible) {
      if (!s.endDate) continue;
      const endTs = new Date(s.endDate).getTime();
      const delta = Math.abs(endTs - resTs);
      if (delta < bestDelta) { bestDelta = delta; best = s; }
    }
    if (best) return { name: best.name, endDate: best.endDate || '' };
  }
  const last = eligible[eligible.length - 1];
  return { name: last.name, endDate: last.endDate || '' };
}

/**
 * Order sprint names chronologically by their endDate.
 * Sprints without an endDate are dropped — they'd make chronological
 * comparison unreliable and are typically malformed / legacy entries.
 */
function orderSprintsByEndDate_(map) {
  return Array.from(map.entries())
    .filter(([, info]) => info.endDate)
    .sort((a, b) => new Date(a[1].endDate).getTime() - new Date(b[1].endDate).getTime())
    .map(([name]) => name);
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

function flagAge_(days, yellow, red) {
  const y = Number(yellow), r = Number(red);
  if (days < y) return '🟢';
  if (days < r) return '🟡';
  return '🔴';
}

/* --- writes ---------------------------------------------------------- */

const EPICS_HEADER = [
  'epic_key', 'summary', 'due_date',
  'tickets_done', 'tickets_in_progress', 'tickets_to_do',
  'sp_done', 'sp_in_progress', 'sp_to_do',
  'sp_closed_last_sprint', 'sp_closed_avg_prior_3',
  'flag_throughput_drop', 'flag_scope_explosion',
  'flag_no_movement', 'flag_unestimated'
];

const EPIC_SPRINT_HISTORY_HEADER = [
  'epic_key', 'sprint_name', 'sprint_end_date', 'sp_closed'
];

const TICKETS_HEADER = [
  'ticket_key', 'epic_key', 'summary', 'status', 'story_points',
  'assignee', 'created', 'updated', 'resolutiondate', 'sprint'
];

function writeEpics_(rows) {
  replaceTab_('Epics', EPICS_HEADER, rows);
}

function writeSprintHistory_(rows) {
  replaceTab_('EpicSprintHistory', EPIC_SPRINT_HISTORY_HEADER, rows);
}

function writeTickets_(rows) {
  replaceTab_('Tickets', TICKETS_HEADER, rows);
}

/**
 * Replace a tab's contents: clear everything, write the header, write rows.
 * Also self-heals if the tab was initialised with an older schema.
 */
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

function logRun_(status, rowsEpics, rowsTickets, errorMsg) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('RunLog');
  if (!sheet) return;
  sheet.appendRow([
    new Date().toISOString(),
    status,
    rowsEpics,
    rowsTickets,
    errorMsg
  ]);
}

/* --- utils ----------------------------------------------------------- */

function formatDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  return String(v);
}

function daysBetween_(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function round1_(n) {
  return Math.round(n * 10) / 10;
}
