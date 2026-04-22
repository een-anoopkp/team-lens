/**
 * team-lens: Epic Risk dashboard — entry points.
 *
 * See docs/epic-risk-design.md for the full design.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Epic Risk')
    .addItem('Initialize Sheet', 'initializeSheet')
    .addSeparator()
    .addItem('Set Jira Token', 'setJiraToken')
    .addItem('Test Jira auth', 'testJiraAuth')
    .addSeparator()
    .addItem('Refresh from Jira', 'refreshFromJira')
    .addItem('Export CSVs', 'exportCsvs')
    .addToUi();
}

function refreshFromJira() {
  SpreadsheetApp.getUi().alert('refreshFromJira: not implemented yet');
}

function exportCsvs() {
  SpreadsheetApp.getUi().alert('exportCsvs: not implemented yet');
}

/**
 * Create the tab skeleton per docs/epic-risk-design.md.
 * Idempotent: existing tabs are left alone; only missing ones are created
 * and header rows written. "Sheet1" is removed if it still exists.
 */
function initializeSheet() {
  const ss = SpreadsheetApp.getActive();
  const schema = {
    Config: [
      ['key', 'value', 'notes'],
      ['quarter_start', '2026-04-01', 'ISO date, edit each quarter'],
      ['quarter_end', '2026-06-30', 'ISO date, edit each quarter'],
      ['team_id', '02623aed-f05b-4acd-8187-7932552722de-28', 'cf[10500] value'],
      ['jira_base_url', 'https://eagleeyenetworks.atlassian.net', ''],
      ['threshold_throughput_yellow', '0.8', 'last sprint ÷ prior-3 avg'],
      ['threshold_throughput_red', '0.5', ''],
      ['threshold_scope_yellow', '0.5', '14-day added ÷ closed'],
      ['threshold_scope_red', '1.0', ''],
      ['threshold_no_movement_yellow_days', '7', 'oldest in-progress age'],
      ['threshold_no_movement_red_days', '14', ''],
      ['threshold_unestimated_yellow', '0.1', 'fraction open with no SP'],
      ['threshold_unestimated_red', '0.3', '']
    ],
    Epics: [[
      'epic_key', 'summary', 'due_date',
      'tickets_done', 'tickets_in_progress', 'tickets_to_do',
      'sp_done', 'sp_in_progress', 'sp_to_do',
      'sp_closed_last_sprint', 'sp_closed_avg_prior_3',
      'flag_throughput_drop', 'flag_scope_explosion',
      'flag_no_movement', 'flag_unestimated'
    ]],
    EpicSprintHistory: [[
      'epic_key', 'sprint_name', 'sp_closed'
    ]],
    Tickets: [[
      'ticket_key', 'epic_key', 'summary', 'status', 'story_points',
      'assignee', 'created', 'updated', 'resolutiondate', 'sprint'
    ]],
    RunLog: [[
      'timestamp', 'status', 'rows_epics', 'rows_tickets', 'error'
    ]]
  };

  const created = [];
  const skipped = [];
  for (const [name, rows] of Object.entries(schema)) {
    let sheet = ss.getSheetByName(name);
    if (sheet) {
      skipped.push(name);
      continue;
    }
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
    created.push(name);
  }

  const default1 = ss.getSheetByName('Sheet1');
  if (default1 && ss.getSheets().length > 1) {
    ss.deleteSheet(default1);
  }

  SpreadsheetApp.getUi().alert(
    'Initialize Sheet\n\n' +
    'Created: ' + (created.join(', ') || '(none)') + '\n' +
    'Already present: ' + (skipped.join(', ') || '(none)')
  );
}
