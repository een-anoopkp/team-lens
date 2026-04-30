/**
 * Centralised helpers for Jira-side links + base URL.
 *
 * Today the URL is hardcoded to the eagleeyenetworks tenant — single-user,
 * single-tenant. When v3 deployment lands, this will read from a config
 * endpoint (`/api/v1/setup/health` or similar) instead.
 */

export const JIRA_BASE_URL = "https://eagleeyenetworks.atlassian.net";

export function jiraIssueUrl(issueKey: string): string {
  return `${JIRA_BASE_URL}/browse/${encodeURIComponent(issueKey)}`;
}

/**
 * Build a Jira "Issue Navigator" URL for an arbitrary JQL string.
 * Lands on the issue list page with the JQL pre-filled.
 */
export function jiraFilterUrl(jql: string): string {
  return `${JIRA_BASE_URL}/issues/?jql=${encodeURIComponent(jql)}`;
}

/**
 * Inline link rendered next to a section header — opens Jira showing
 * exactly the listed issue keys. Renders nothing when `keys` is empty.
 */
export function JiraFilterLink({
  keys,
  orderBy,
  label = "View in Jira ↗",
}: {
  keys: string[];
  orderBy?: string;
  label?: string;
}) {
  if (keys.length === 0) return null;
  const jql =
    `key in (${keys.join(",")})` + (orderBy ? ` ORDER BY ${orderBy}` : "");
  return (
    <a
      href={jiraFilterUrl(jql)}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        marginLeft: 12,
        fontSize: "var(--font-size-sm)",
        fontWeight: 400,
        color: "var(--color-accent)",
        textDecoration: "none",
      }}
      title={`Open these ${keys.length} ticket${keys.length === 1 ? "" : "s"} in Jira`}
    >
      {label}
    </a>
  );
}

interface JiraLinkProps {
  issueKey: string;
  className?: string;
}

/**
 * Renders a Jira issue key as a clickable chip linking to the actual
 * ticket in a new tab. Replaces bare `<code>{issue_key}</code>` everywhere.
 */
export function JiraLink({ issueKey, className }: JiraLinkProps) {
  return (
    <a
      className={className ? `jira-link ${className}` : "jira-link"}
      href={jiraIssueUrl(issueKey)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${issueKey} in Jira`}
    >
      {issueKey}
    </a>
  );
}
