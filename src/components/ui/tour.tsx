"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * Step-by-step product tour. Spotlights a real UI element per step (dim everything else with a giant
 * box-shadow "hole"), anchors a tooltip beside it, and offers Back / Next / Skip. Auto-runs once per
 * browser (localStorage), and a floating "?" button replays it. Targets are matched by selector, so
 * a step whose element is absent simply shows a centered tooltip instead of breaking.
 */
type Step = { selector: string; title: string; body: string };

const STEPS: Step[] = [
  { selector: '[data-tour="command"]', title: "Your command line", body: 'Type any trade in plain English, like "Sell 0.05 TSLA". Neighbor parses it and quotes it live.' },
  { selector: '[data-tour="examples"]', title: "One tap to start", body: "New here? Tap an example. Neighbor fills the box and previews the quote for you." },
  { selector: "#wallet", title: "Your wallet", body: "A noncustodial wallet is spun up for you. Fund it from the testnet faucet, then trade." },
  { selector: "#markets", title: "Explore tokens", body: "Every tradeable token is here. Hit Trade on any row to load it into the terminal." },
];
const SEEN_KEY = "neighbor.tour.v1";

export function Tour() {
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const targetOf = (idx: number) => document.querySelector(STEPS[idx]?.selector ?? "");

  const measure = useCallback(() => {
    const el = targetOf(i);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [i]);

  // Auto-run once, after the terminal has mounted (auth resolves async).
  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY)) return;
    let tries = 0;
    const id = setInterval(() => {
      if (document.querySelector('[data-tour="command"]')) {
        clearInterval(id);
        setI(0);
        setActive(true);
      } else if (++tries > 20) clearInterval(id);
    }, 300);
    return () => clearInterval(id);
  }, []);

  // Replay trigger (floating button dispatches this).
  useEffect(() => {
    const start = () => { setI(0); setActive(true); };
    window.addEventListener("neighbor:tour", start);
    return () => window.removeEventListener("neighbor:tour", start);
  }, []);

  // Scroll the step's target into view, then measure it (and re-measure as smooth-scroll settles).
  useLayoutEffect(() => {
    if (!active) return;
    targetOf(i)?.scrollIntoView({ behavior: "smooth", block: "center" });
    measure();
    const timers = [setTimeout(measure, 260), setTimeout(measure, 560)];
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [active, i, measure]);

  const finish = () => { setActive(false); localStorage.setItem(SEEN_KEY, "1"); };

  if (!active) return null; // replay is triggered from the topbar Guide button (neighbor:tour event)

  const step = STEPS[i]!;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const holeStyle: React.CSSProperties = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : { display: "none" };

  // Place the tooltip below the target, or above when there is not enough room underneath.
  const below = !rect || rect.bottom + 260 < vh || rect.top < vh * 0.35;
  const left = rect ? Math.max(12, Math.min(rect.left, vw - 332)) : vw / 2 - 160;
  const tipStyle: React.CSSProperties = rect
    ? below
      ? { top: rect.bottom + pad + 12, left }
      : { bottom: vh - rect.top + pad + 12, left }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="tour">
      <div className="tour-block" />
      <div className="tour-hole" style={holeStyle} />
      <div className="tour-tip" style={tipStyle}>
        <div className="tour-tip-head">
          <span className="tour-step">{i + 1} / {STEPS.length}</span>
          <button className="tour-skip" onClick={finish}>Skip</button>
        </div>
        <p className="tour-title">{step.title}</p>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          {i < STEPS.length - 1
            ? <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next ▸</button>
            : <button className="btn btn-primary" onClick={finish}>Got it</button>}
        </div>
      </div>
    </div>
  );
}
