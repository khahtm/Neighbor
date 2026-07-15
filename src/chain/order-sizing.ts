import { parseUnits } from "viem";
import type { Intent } from "@/agent/intent-schema";
import type { ChainEnv } from "./chains";
import { quoteSymbolFor, resolveAsset, type TokenMeta } from "./token-registry";

/**
 * Turn a confirmed intent into the concrete legs of a swap. This is the deterministic bridge between
 * the parsed intent and the quote/execution layer: it resolves the trade direction and, where the
 * amount is knowable without live state, the exact `amountIn`.
 *
 * Two cases genuinely need live state and are surfaced as explicit outcomes rather than guessed:
 *   - percent unit  -> needs the wallet balance (e.g. "sell 50% of TSLA")
 *   - exact-OUTPUT   -> "buy 10 TSLA" / "sell $50 of TSLA" fixes the OUTPUT side, so the input amount
 *                       comes from the quote, not from arithmetic.
 * The routes treat those as a seam (needs balance / needs quote) instead of fabricating a number.
 */

export type SizedOrder =
  | {
      kind: "exact-in";
      tokenIn: TokenMeta;
      tokenOut: TokenMeta;
      amountIn: bigint; // in tokenIn's smallest unit
    }
  | {
      kind: "needs-balance";
      tokenIn: TokenMeta;
      tokenOut: TokenMeta;
      percent: number; // 0..100 of the tokenIn balance
    }
  | {
      kind: "needs-quote-exact-out";
      tokenIn: TokenMeta;
      tokenOut: TokenMeta;
      amountOut: bigint; // desired output in tokenOut's smallest unit
    }
  | { kind: "reject"; reason: string };

/** buy => spend the quote asset for the target; sell => sell the target for the quote asset. */
function legs(env: ChainEnv, intent: Intent): { tokenIn: TokenMeta; tokenOut: TokenMeta } | null {
  const asset = resolveAsset(env, intent.asset);
  const quote = resolveAsset(env, quoteSymbolFor(env));
  if (!asset || !quote) return null;
  // "swap" with a single named asset is treated as a buy of that asset with the quote asset.
  return intent.action === "sell" ? { tokenIn: asset, tokenOut: quote } : { tokenIn: quote, tokenOut: asset };
}

export function sizeOrder(env: ChainEnv, intent: Intent): SizedOrder {
  const pair = legs(env, intent);
  if (!pair) return { kind: "reject", reason: `unsupported pair for ${intent.asset}` };
  const { tokenIn, tokenOut } = pair;

  if (intent.unit === "percent") {
    const percent = Number(intent.amount);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { kind: "reject", reason: `invalid percent ${intent.amount}` };
    }
    return { kind: "needs-balance", tokenIn, tokenOut, percent };
  }

  if (intent.unit === "USD") {
    // The USD amount is denominated in the quote (USDG) asset. When the quote asset IS tokenIn
    // (a buy), spending $X is an exact-input of X USDG. When tokenIn is the stock (a USD-denominated
    // sell), $X fixes the OUTPUT side => needs a quote to size the input.
    if (tokenIn.symbol === quoteSymbolFor(env)) {
      return { kind: "exact-in", tokenIn, tokenOut, amountIn: parseUnits(intent.amount, tokenIn.decimals) };
    }
    return {
      kind: "needs-quote-exact-out",
      tokenIn,
      tokenOut,
      amountOut: parseUnits(intent.amount, tokenOut.decimals),
    };
  }

  // token unit: the amount is denominated in the asset the user named (never the quote asset).
  // sell N TSLA => exact-input of N tokenIn. buy N TSLA => exact-output of N tokenOut.
  if (intent.action === "sell") {
    return { kind: "exact-in", tokenIn, tokenOut, amountIn: parseUnits(intent.amount, tokenIn.decimals) };
  }
  return { kind: "needs-quote-exact-out", tokenIn, tokenOut, amountOut: parseUnits(intent.amount, tokenOut.decimals) };
}
