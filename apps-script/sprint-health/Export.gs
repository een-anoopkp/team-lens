/**
 * team-lens: Sprint Health — CSV export.
 *
 * exportCsvs() is wired to the Sheet menu. It serialises the coaching-view
 * tabs plus a small meta row (drawn from the latest RunLog entry) and
 * opens a modal dialog with one-click download buttons. Drop the files
 * into ~/dashboards/sprint-health/ where the local HTML page reads them.
 *
 * Tabs that are published:
 *   - velocity.csv          ← VelocityComputed
 *   - carry_over.csv        ← CarryOver
 *   - scope_changes.csv     ← ScopeChanges
 *   - epic_contribution.csv ← EpicContribution
 *   - meta.csv              ← synthesised from the newest RunLog row
 *
 * Raw Tickets / TicketState / Sprints / Leave are intentionally NOT
 * exported — per-person data stays in the Sheet. See design doc for why.
 */

function exportCsvs() {
  const ss = SpreadsheetApp.getActive();
  const files = {
    'velocity.csv': sheetToCsv_(ss.getSheetByName('VelocityComputed')),
    'carry_over.csv': sheetToCsv_(ss.getSheetByName('CarryOver')),
    'scope_changes.csv': sheetToCsv_(ss.getSheetByName('ScopeChanges')),
    'blockers.csv': sheetToCsv_(ss.getSheetByName('Blockers')),
    'sprint_progress_active.csv': sheetToCsv_(ss.getSheetByName('SprintProgressActive')),
    'epic_contribution.csv': sheetToCsv_(ss.getSheetByName('EpicContribution')),
    'meta.csv': buildMetaCsv_(ss.getSheetByName('RunLog'))
  };
  const html = buildExportDialog_(files);
  SpreadsheetApp.getUi().showModalDialog(html, 'Export CSVs');
}

function sheetToCsv_(sheet) {
  if (!sheet) return '';
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) return '';
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  return rowsToCsv_(values);
}

function buildMetaCsv_(runLog) {
  const header = [
    'last_run_iso', 'last_run_status', 'rows_tickets', 'rows_velocity',
    'scope_changes_new', 'leave_name_mismatches', 'active_sprint',
    'hygiene_unassigned', 'hygiene_nosp', 'hygiene_noepic', 'error'
  ];
  const last = readLastRunLogRow_(runLog);
  const row = last || ['', 'no_runs_yet', '', '', '', '', '', '', '', '', ''];
  return rowsToCsv_([header, row]);
}

function readLastRunLogRow_(runLog) {
  if (!runLog) return null;
  const lastRow = runLog.getLastRow();
  if (lastRow < 2) return null;
  const cols = runLog.getLastColumn();
  return runLog.getRange(lastRow, 1, 1, cols).getValues()[0];
}

function rowsToCsv_(rows) {
  return rows.map(row => row.map(csvEscape_).join(',')).join('\n') + '\n';
}

function csvEscape_(cell) {
  if (cell === null || cell === undefined) return '';
  let s;
  if (cell instanceof Date) {
    s = cell.toISOString();
  } else {
    s = String(cell);
  }
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 ||
      s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildExportDialog_(files) {
  const rows = Object.keys(files).map(name => {
    const b64 = Utilities.base64Encode(files[name], Utilities.Charset.UTF_8);
    const href = 'data:text/csv;charset=utf-8;base64,' + b64;
    const size = files[name].length;
    return '<li><a href="' + href + '" download="' + name + '">' + name +
      '</a> <span class="size">(' + size + ' bytes)</span></li>';
  }).join('');

  const body =
    '<style>' +
      'body{font:14px/1.4 system-ui,sans-serif;padding:12px;}' +
      'h3{margin:0 0 8px 0;font-size:15px;}' +
      'ul{padding-left:20px;margin:0 0 12px 0;}' +
      'li{margin:4px 0;}' +
      'a{color:#1a73e8;text-decoration:none;}' +
      'a:hover{text-decoration:underline;}' +
      '.size{color:#777;font-size:12px;margin-left:6px;}' +
      '.hint{color:#555;font-size:13px;margin-top:8px;}' +
      'button{padding:6px 12px;margin-top:8px;cursor:pointer;}' +
    '</style>' +
    '<h3>Click each link to download.</h3>' +
    '<ul>' + rows + '</ul>' +
    '<button onclick="downloadAll()">Download all</button>' +
    '<div class="hint">Drop the files into <code>~/dashboards/sprint-health/</code>, ' +
    'then reload the local page.</div>' +
    '<script>' +
      'function downloadAll(){' +
        'const links = document.querySelectorAll("a[download]");' +
        'links.forEach((a, i) => setTimeout(() => a.click(), i * 150));' +
      '}' +
    '</script>';

  return HtmlService.createHtmlOutput(body).setWidth(440).setHeight(300);
}
