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
  return jiraRequest_('get', path, null);
}

/**
 * POST JSON to a Jira REST path and return parsed JSON.
 */
function jiraPost(path, body) {
  return jiraRequest_('post', path, body);
}

function jiraRequest_(method, path, body) {
  const props = PropertiesService.getUserProperties();
  const email = props.getProperty(JIRA_EMAIL_KEY);
  const token = props.getProperty(JIRA_TOKEN_KEY);
  if (!email || !token) {
    throw new Error('Jira credentials not set. Run "Set Jira Token" menu item.');
  }

  const baseUrl = getConfigValue('jira_base_url');
  if (!baseUrl) throw new Error('Config.jira_base_url is empty.');

  const url = baseUrl.replace(/\/$/, '') + path;
  const options = {
    method: method,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(email + ':' + token),
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  };
  if (body !== null && body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      return JSON.parse(response.getContentText());
    }

    const bodyText = response.getContentText();
    const retryable = code === 429 || code === 503 || /bandwidth|quota|rate limit/i.test(bodyText);
    if (!retryable || attempt === maxAttempts) {
      throw new Error('Jira ' + code + ' on ' + method.toUpperCase() + ' ' + path +
        ': ' + bodyText.slice(0, 500));
    }

    const headers = response.getHeaders() || {};
    const retryAfterHdr = headers['Retry-After'] || headers['retry-after'];
    const retryAfterSec = Number(retryAfterHdr);
    const waitSec = (retryAfterSec > 0) ? retryAfterSec : Math.pow(2, attempt);
    console.log('Jira ' + code + ' on ' + path + ' (attempt ' + attempt + '/' +
      maxAttempts + '); backing off ' + waitSec + 's');
    Utilities.sleep(waitSec * 1000);
  }
}

/**
 * Paginated search via /rest/api/3/search/jql (Jira Cloud's current API;
 * the legacy /search is deprecated). Returns all matching issues.
 */
function searchJql(jql, fields) {
  const all = [];
  let nextPageToken = null;
  let page = 0;
  const maxPages = 50;
  do {
    if (page > 0) Utilities.sleep(300);
    const body = { jql: jql, fields: fields, maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const resp = jiraPost('/rest/api/3/search/jql', body);
    if (resp.issues && resp.issues.length) all.push.apply(all, resp.issues);
    nextPageToken = resp.nextPageToken || null;
    page++;
    if (page > maxPages) {
      throw new Error('searchJql exceeded ' + maxPages + ' pages — JQL: ' + jql);
    }
  } while (nextPageToken);
  return all;
}

/**
 * Resolve a Jira custom field by human-readable name. Accepts an array of
 * candidate names and returns the first match. Cached for 1 hour.
 */
function getCustomFieldId(nameCandidates) {
  const names = Array.isArray(nameCandidates) ? nameCandidates : [nameCandidates];
  const cache = CacheService.getScriptCache();
  const cacheKey = 'field:' + names.join('|');
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const fields = jiraGet('/rest/api/3/field');
  for (const name of names) {
    const found = fields.find(f => f.name && f.name.toLowerCase() === name.toLowerCase());
    if (found) {
      cache.put(cacheKey, found.id, 3600);
      console.log('Resolved custom field "' + name + '" -> ' + found.id);
      return found.id;
    }
  }
  const customNames = fields.filter(f => f.custom).map(f => f.name).slice(0, 40);
  throw new Error('No custom field matched any of: ' + names.join(', ') +
    '. Available (first 40): ' + customNames.join(', '));
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
