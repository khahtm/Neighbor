"use client";

/**
 * "Trade" button for a markets row. Dispatches a window event the trade terminal listens for, which
 * prefills the command and previews it — so clicking Trade jumps straight into a quote for that token.
 */
export function TradeCta({ symbol }: { symbol: string }) {
  return (
    <button
      className="btn btn-accent"
      style={{ padding: "7px 14px", fontSize: 13 }}
      onClick={() => window.dispatchEvent(new CustomEvent("neighbor:trade", { detail: { symbol } }))}
    >
      Trade
    </button>
  );
}
