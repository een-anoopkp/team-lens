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
