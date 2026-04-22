/**
 * team-lens: Epic Risk — scheduled triggers.
 *
 * installDailyTrigger() registers a time-based trigger that fires
 * refreshFromJira() once per day at 07:00 local time (the project's
 * configured timezone — Asia/Kolkata). removeDailyTrigger() tears down
 * any existing triggers for refreshFromJira so you can cleanly reset.
 */

const REFRESH_HANDLER = 'refreshFromJira';
const DAILY_HOUR = 7;

function installDailyTrigger() {
  const ui = SpreadsheetApp.getUi();
  const existing = currentRefreshTriggers_();
  existing.forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger(REFRESH_HANDLER)
    .timeBased()
    .atHour(DAILY_HOUR)
    .everyDays(1)
    .create();

  ui.alert('Daily trigger installed.\n\n' +
    'refreshFromJira will run every day around ' + DAILY_HOUR + ':00 ' +
    'in the project timezone (see appsscript.json).\n' +
    (existing.length ? ('Replaced ' + existing.length + ' previous trigger(s).') : ''));
}

function removeDailyTrigger() {
  const existing = currentRefreshTriggers_();
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  SpreadsheetApp.getUi().alert('Removed ' + existing.length + ' refreshFromJira trigger(s).');
}

function currentRefreshTriggers_() {
  return ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === REFRESH_HANDLER);
}
