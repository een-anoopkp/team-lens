/**
 * team-lens: Sprint Health dashboard — entry points.
 *
 * See docs/sprint-health-design.md for the full design.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sprint Health')
    .addItem('Initialize Sheet', 'initializeSheet')
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
 * Create the tab skeleton per docs/sprint-health-design.md.
 * Idempotent: existing tabs are left alone; only missing ones are created
 * and header rows written. "Sheet1" is removed if it still exists.
 *
 * Note: the Leave data lives in a separate external sheet referenced by
 * Config.leave_sheet_id — no Leave tab is created here.
 */
function initializeSheet() {
  const ss = SpreadsheetApp.getActive();
  const schema = {
    Config: [
      ['key', 'value', 'notes'],
      ['team_id', '02623aed-f05b-4acd-8187-7932552722de-28', 'cf[10500] value'],
      ['jira_base_url', 'https://een.atlassian.net', ''],
      ['leave_sheet_id', '', 'ID of the existing Leave sheet (external)'],
      ['sprint_ids_last6', '', 'comma-separated Jira sprint IDs, newest last'],
      ['sprint_working_days_default', '10', 'working-days per sprint if not overridden'],
      ['threshold_velocity_yellow', '0.8', 'current vs own prior-3 avg'],
      ['threshold_velocity_red', '0.5', ''],
      ['threshold_accuracy_yellow', '0.85', 'SP completed ÷ SP committed'],
      ['threshold_accuracy_red', '0.6', ''],
      ['threshold_carryover_yellow_sprints', '2', ''],
      ['threshold_carryover_red_sprints', '3', ''],
      ['threshold_blocker_age_yellow_days', '3', 'oldest open sub-task'],
      ['threshold_blocker_age_red_days', '7', ''],
      ['threshold_scope_inflation_yellow', '0.01', 'SP % added after sprint start'],
      ['threshold_scope_inflation_red', '0.5', '']
    ],
    Tickets: [[
      'ticket_key', 'parent_epic_key', 'summary', 'issuetype', 'status',
      'story_points', 'assignee', 'created', 'updated', 'resolutiondate',
      'sprint', 'sp_changelog_after_sprint_start'
    ]],
    Sprints: [[
      'sprint_name', 'person', 'sp_committed', 'sp_completed',
      'working_days', 'leave_days', 'available_days'
    ]],
    VelocityComputed: [[
      'person', 'sprint', 'sp_committed', 'sp_completed',
      'working_days', 'leave_days', 'available_days',
      'velocity', 'commitment_accuracy',
      'flag_velocity_drop', 'flag_accuracy_drop'
    ]],
    CarryOver: [[
      'ticket_key', 'assignee', 'depth_sprints', 'status',
      'original_sp', 'current_sp', 'summary'
    ]],
    ScopeChanges: [[
      'ticket_key', 'assignee', 'sprint', 'changed_at',
      'sp_before', 'sp_after', 'delta', 'pct_of_original'
    ]],
    RunLog: [[
      'timestamp', 'status', 'rows_tickets', 'rows_velocity',
      'leave_name_mismatches', 'error'
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
