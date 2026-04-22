/**
 * Minimal Jira REST client.
 *
 * Credentials are stored per-user via PropertiesService.getUserProperties()
 * — never written to the Sheet and never committed. Run "Set Jira Token"
 * once from the dashboard menu to save email + API token; then every
 * jiraGet() call reuses them.
 *
 * Token source: https://id.atlassian.com/manage-profile/security/api-tokens
 */

const JIRA_EMAIL_KEY = 'JIRA_EMAIL';
const JIRA_TOKEN_KEY = 'JIRA_TOKEN';

function setJiraToken() {
  const ui = SpreadsheetApp.getUi();

  const emailResp = ui.prompt(
    'Set Jira Token (1/2)',
    'Atlassian email:',
    ui.ButtonSet.OK_CANCEL
  );
  if (emailResp.getSelectedButton() !== ui.Button.OK) return;
  const email = emailResp.getResponseText().trim();
  if (!email) { ui.alert('Email is empty. Aborted.'); return; }

  const tokenResp = ui.prompt(
    'Set Jira Token (2/2)',
    'API token (from id.atlassian.com → Security → API tokens):',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenResp.getSelectedButton() !== ui.Button.OK) return;
  const token = tokenResp.getResponseText().trim();
  if (!token) { ui.alert('Token is empty. Aborted.'); return; }

  const props = PropertiesService.getUserProperties();
  props.setProperty(JIRA_EMAIL_KEY, email);
  props.setProperty(JIRA_TOKEN_KEY, token);
  ui.alert('Saved for user ' + email + '. Use "Test Jira auth" to verify.');
}

function testJiraAuth() {
  const ui = SpreadsheetApp.getUi();
  try {
    const me = jiraGet('/rest/api/3/myself');
    ui.alert(
      'Authenticated.\n\n' +
      'Display name: ' + me.displayName + '\n' +
      'Email: ' + me.emailAddress + '\n' +
      'Account ID: ' + me.accountId
    );
  } catch (e) {
    ui.alert('Auth failed.\n\n' + e.message);
  }
}

/**
 * GET a Jira REST path relative to Config.jira_base_url and return parsed JSON.
 * Throws on non-2xx with a truncated body for diagnosis.
 */
function jiraGet(path) {
  const props = PropertiesService.getUserProperties();
  const email = props.getProperty(JIRA_EMAIL_KEY);
  const token = props.getProperty(JIRA_TOKEN_KEY);
  if (!email || !token) {
    throw new Error('Jira credentials not set. Run "Set Jira Token" menu item.');
  }

  const baseUrl = getConfigValue('jira_base_url');
  if (!baseUrl) throw new Error('Config.jira_base_url is empty.');

  const url = baseUrl.replace(/\/$/, '') + path;
  const authHeader = 'Basic ' + Utilities.base64Encode(email + ':' + token);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: authHeader, Accept: 'application/json' },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Jira ' + code + ' on ' + path + ': ' +
      response.getContentText().slice(0, 500));
  }
  return JSON.parse(response.getContentText());
}

/**
 * Read a value from the Config tab's two-column key/value layout.
 * Returns null if the key isn't found. Empty cells come back as "".
 */
function getConfigValue(key) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sheet) throw new Error('Config sheet missing. Run "Initialize Sheet".');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (const [k, v] of data) {
    if (k === key) return v;
  }
  return null;
}
