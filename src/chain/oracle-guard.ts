import type { OracleReading } from "./oracle";

/**
 * Oracle sanity policy (plan red-team C3). The read layer (oracle.ts) returns a raw Chainlink
 * reading + staleness; this module decides WHETHER to block a swap on price divergence.
 *
 * The subtle failure the red team flagged: tokenized-stock feeds update 24/5 (US market hours) but
 * the pool trades 24/7. Off-hours the NAV feed is legitimately stale, so blocking a swap because it
 * diverges from a frozen overnight NAV would be WRONG (it would reject valid trades). Policy:
 *   - fresh feed AND market open  -> NAV is the reference; block if pool price deviates beyond cap
 *   - stale OR market closed       -> ignore NAV; use pool TWAP as reference; do not NAV-block
 */

/** Max pool-vs-NAV deviation before a market swap is blocked — concrete P1 value (2.0%). */
export const ORACLE_DEVIATION_MAX_BPS = 200;

export type PriceSource = "nav" | "pool-twap";

export interface ReferenceDecision {
  source: PriceSource;
  /** Reference price in the same fixed-point scale as the compared quote price. */
  reference: bigint;
  /** True only when NAV is authoritative (fresh + market open) — the only case we NAV-block. */
  navAuthoritative: boolean;
}

/**
 * US equity regular session, approximated in UTC: Mon–Fri 13:30–20:00 UTC (09:30–16:00 ET).
 * Holidays are intentionally NOT modeled — on a holiday the feed simply goes stale and we fall back
 * to TWAP, which is the safe direction (we never wrongly NAV-block; worst case we skip a NAV check
 * we could have done). `nowSeconds` is injected for testability.
 */
export function isUsEquityMarketOpen(nowSeconds: number): boolean {
  const d = new Date(nowSeconds * 1000);
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 13 * 60 + 30 && minutes < 20 * 60;
}

/** Choose the price reference for the divergence check based on feed freshness + market hours. */
export function chooseReference(reading: OracleReading, poolTwap: bigint, nowSeconds: number): ReferenceDecision {
  const marketOpen = isUsEquityMarketOpen(nowSeconds);
  const navAuthoritative = !reading.isStale && marketOpen;
  return navAuthoritative
    ? { source: "nav", reference: reading.answer, navAuthoritative: true }
    : { source: "pool-twap", reference: poolTwap, navAuthoritative: false };
}

/** Absolute deviation of `price` from `reference`, in bps. Reference must be > 0. */
export function deviationBps(price: bigint, reference: bigint): number {
  if (reference <= 0n) throw new Error("reference price must be > 0");
  const diff = price > reference ? price - reference : reference - price;
  return Number((diff * 10_000n) / reference);
}

export type OracleGuardResult = { ok: true; source: PriceSource } | { ok: false; reason: string; source: PriceSource };

/**
 * Decide whether a market swap may proceed given the quoted pool price. We ONLY block on NAV
 * divergence when NAV is authoritative (fresh + market open); off-hours we accept the pool price
 * (TWAP reference) rather than reject the trade on a stale feed.
 */
export function checkOracleSanity(
  quotedPrice: bigint,
  reading: OracleReading,
  poolTwap: bigint,
  nowSeconds: number,
  maxDeviationBps: number = ORACLE_DEVIATION_MAX_BPS,
): OracleGuardResult {
  const decision = chooseReference(reading, poolTwap, nowSeconds);
  if (!decision.navAuthoritative) return { ok: true, source: decision.source };
  const dev = deviationBps(quotedPrice, decision.reference);
  return dev > maxDeviationBps
    ? { ok: false, reason: `pool price deviates ${dev}bps from NAV (cap ${maxDeviationBps}bps)`, source: decision.source }
    : { ok: true, source: decision.source };
}
