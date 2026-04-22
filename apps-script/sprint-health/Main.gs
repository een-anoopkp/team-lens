/**
 * team-lens: Sprint Health dashboard — entry points.
 *
 * See docs/sprint-health-design.md for the full design. This file is the
 * skeleton: onOpen installs the Sheet menu; refreshFromJira and exportCsvs
 * are stubs to be filled in next.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sprint Health')
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
