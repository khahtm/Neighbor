import type { Action, Unit } from "./intent-schema";
import { registryFor, QUOTE_SYMBOLS } from "@/chain/token-registry";
import type { ChainEnv } from "@/chain/chains";

/**
 * Deterministic extraction of the trade-critical fields (action, amount, unit, asset) straight
 * from the raw user string — NO LLM involved. This is the source of truth that the LLM intent is
 * cross-checked against, so a prompt-injected or hallucinated amount/asset cannot slip through
 * (red-team C11). Intentionally conservative: emits only what it can read unambiguously.
 */
export interface DeterministicParse {
  action: Action | null;
  amount: string | null; // decimal string
  unit: Unit | null;
  asset: string | null; // registry symbol (uppercase)
}

const ACTION_WORDS: Record<string, Action> = {
  buy: "buy",
  purchase: "buy",
  sell: "sell",
  dump: "sell",
  swap: "swap",
  convert: "swap",
  trade: "swap",
};

/** First recognised action keyword (word-boundary, case-insensitive). */
function findAction(text: string): Action | null {
  for (const m of text.toLowerCase().matchAll(/[a-z]+/g)) {
    const a = ACTION_WORDS[m[0]];
    if (a) return a;
  }
  return null;
}

/** Amount + unit. Order: `$50` / `50 usd` (USD) → `50%` / `all` (percent) → `0.1 eth` (token). */
function findAmount(text: string): { amount: string | null; unit: Unit | null } {
  const usd = text.match(/\$\s*([\d,]+(?:\.\d+)?)|\b([\d,]+(?:\.\d+)?)\s*(?:usd|dollars?)\b/i);
  if (usd) {
    const raw = (usd[1] ?? usd[2] ?? "").replace(/,/g, "");
    if (raw) return { amount: raw, unit: "USD" };
  }
  if (/\b(all|everything|max)\b/i.test(text)) return { amount: "100", unit: "percent" };
  const pct = text.match(/\b(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { amount: pct[1]!, unit: "percent" };
  const tok = text.match(/\b(\d+(?:\.\d+)?)\s*([a-z]{2,12})\b/i);
  if (tok) return { amount: tok[1]!, unit: "token" };
  return { amount: null, unit: null };
}

/**
 * Asset = a registry symbol that appears in the text. If MORE THAN ONE distinct registry symbol
 * (excluding the quote asset) appears, return null → forces clarify, since we cannot be sure which
 * the user meant (an injection like "buy TSLA ... sell NVDA" must not auto-resolve).
 */
function findAsset(text: string, env: ChainEnv): string | null {
  const symbols = Object.keys(registryFor(env));
  const upper = text.toUpperCase();
  const hits = symbols.filter((s) => new RegExp(`\\b${s}\\b`).test(upper) && !QUOTE_SYMBOLS.has(s));
  return hits.length === 1 ? hits[0]! : null;
}

export function deterministicParse(text: string, env: ChainEnv): DeterministicParse {
  const { amount, unit } = findAmount(text);
  return { action: findAction(text), amount, unit, asset: findAsset(text, env) };
}
