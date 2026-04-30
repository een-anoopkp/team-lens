/**
 * Notes popover — modal-style overlay over the standup board for one
 * ticket. Stub for step 4; full editing UI lands in step 5.
 */

interface Props {
  issueKey: string;
  onClose: () => void;
}

export default function NotesPopover({ issueKey, onClose }: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-4)",
          width: 480,
          maxWidth: "90vw",
        }}
      >
        <h3 style={{ marginTop: 0 }}>{issueKey}</h3>
        <p className="muted small">
          Notes editor lands in the next commit. Esc / click outside to close.
        </p>
      </div>
    </div>
  );
}
