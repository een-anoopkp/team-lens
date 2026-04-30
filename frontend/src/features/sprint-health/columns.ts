/**
 * Status → board-column mapping for the standup board.
 *
 * Anything not in the dict falls into "todo". Add new statuses here
 * as the team adopts them.
 */

export type ColumnId =
  | "todo"
  | "in_progress"
  | "in_review"
  | "in_validation"
  | "done";

export const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "in_review", label: "In Review" },
  { id: "in_validation", label: "In Validation" },
  { id: "done", label: "Done" },
];

const STATUS_TO_COLUMN: Record<string, ColumnId> = {
  // To Do
  "To Do": "todo",
  Open: "todo",
  Reopened: "todo",
  Backlog: "todo",
  Ready: "todo",
  // In Progress
  "In Progress": "in_progress",
  "In Development": "in_progress",
  // In Review
  "In Review": "in_review",
  "Code Review": "in_review",
  // In Validation
  "In Validation": "in_validation",
  QA: "in_validation",
  Validation: "in_validation",
  // Done
  Done: "done",
  Closed: "done",
  Resolved: "done",
};

export function statusToColumn(status: string): ColumnId {
  return STATUS_TO_COLUMN[status] ?? "todo";
}
