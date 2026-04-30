/**
 * Inline info icon for explaining ambiguous column headers / labels.
 * Hover (or focus on touch / keyboard) to read the description.
 *
 * Native `title` attribute drives the tooltip — good enough for v1 with no
 * extra deps. Swap in a proper Radix popover later if we need rich content.
 */

interface Props {
  /** Tooltip text — kept short; full sentences OK. */
  text: string;
  /** Icon size (px). Defaults to 14. */
  size?: number;
}

export default function InfoIcon({ text, size = 14 }: Props) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      tabIndex={0}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--color-neutral-bg)",
        color: "var(--color-text-muted)",
        fontSize: Math.round(size * 0.75),
        fontWeight: 600,
        fontStyle: "italic",
        marginLeft: 4,
        cursor: "help",
        verticalAlign: "middle",
        userSelect: "none",
        textTransform: "none",
        letterSpacing: "normal",
        lineHeight: 1,
      }}
    >
      i
    </span>
  );
}
