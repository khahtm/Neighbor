"use client";

import { useEffect, useState } from "react";

/**
 * Rotating helper tip — shows a different hint on every page load to teach the natural-language
 * terminal and keep the surface lively. The tip is picked in an effect (client-only) so the random
 * choice never diverges between server and client render (no hydration mismatch); nothing renders
 * until it is chosen.
 */
const TIPS = [
  'Type it plainly: "Sell 0.05 TSLA" or "Buy $10 of TSLA".',
  "Neighbor trades any listed token, not only stocks.",
  "Your wallet signs every swap. Neighbor never holds your keys.",
  "Percent orders work too: try “Sell 25% of TSLA”.",
  "Every quote is live from the onchain pool.",
  "First swap of a token needs one approval, then never again.",
  "Prices come straight from Robinhood Chain in real time.",
];

export function Tip() {
  const [tip, setTip] = useState<string | null>(null);
  useEffect(() => {
    setTip(TIPS[Math.floor(Math.random() * TIPS.length)] ?? TIPS[0] ?? null);
  }, []);

  if (!tip) return null;
  return (
    <p className="tip">
      <span className="tip-ico" aria-hidden>💡</span>
      <span>{tip}</span>
    </p>
  );
}
