/**
 * Inline "working" indicator — a labelled busy state with three bouncing dots. Replaces the bare "…"
 * on action buttons while a request is in flight. Dots inherit `currentColor`, so it reads correctly
 * on any button (lime primary, ghost, etc.).
 */
export function Working({ label = "Working on it" }: { label?: string }) {
  return (
    <span className="working">
      {label}
      <span className="working-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
