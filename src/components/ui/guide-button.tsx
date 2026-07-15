"use client";

/**
 * Topbar "Guide" button — replays the product tour. It just fires the `neighbor:tour` event that the
 * Tour component listens for, so the two stay decoupled (button in the topbar, tour mounted globally).
 */
export function GuideButton() {
  return (
    <button
      className="guide-btn"
      onClick={() => window.dispatchEvent(new Event("neighbor:tour"))}
      aria-label="Take a guided tour"
      title="Take a guided tour"
    >
      <span className="guide-btn-q">?</span>
      Guide
    </button>
  );
}
