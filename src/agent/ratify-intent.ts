import { IntentSchema, type Intent } from "./intent-schema";
import { deterministicParse } from "./deterministic-parse";
import { resolveAsset } from "@/chain/token-registry";
import type { ChainEnv } from "@/chain/chains";

/**
 * Server-side ratification of a client-supplied intent before it is sized, quoted, or executed.
 *
 * The confirm UI sends back the intent the user approved, but the money path must NEVER trust that
 * blindly (a tampered client or a stale confirm could differ). We independently re-derive the trade
 * fields from the raw text with the deterministic parser and require an exact match — no LLM call,
 * no network. This is the same authority rule as guards.reconcile (red-team C11), reused at the
 * execution boundary so quote and execute both re-check rather than one trusting the other.
 */
export type RatifyResult = { ok: true; intent: Intent } | { ok: false; reason: string };

export function ratifyIntent(rawText: string, candidate: unknown, env: ChainEnv): RatifyResult {
  const parsed = IntentSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "intent did not match the expected shape" };
  const intent = parsed.data;

  const asset = resolveAsset(env, intent.asset);
  if (!asset) return { ok: false, reason: `unknown or unsupported asset: ${intent.asset}` };

  const det = deterministicParse(rawText, env);
  if (!det.asset || det.asset.toUpperCase() !== asset.symbol.toUpperCase()) {
    return { ok: false, reason: "asset does not match the raw message" };
  }
  // The trade DIRECTION is fund-critical: never trust the model's buy/sell when the message does not
  // state one explicitly — a prompt-injected intent could flip it (C11). Require an independent read.
  if (!det.action) {
    return { ok: false, reason: "trade direction (buy/sell/swap) not stated explicitly in the message" };
  }
  if (det.action !== intent.action) {
    return { ok: false, reason: "action does not match the raw message" };
  }
  if (!det.amount || det.unit === null) {
    return { ok: false, reason: "amount could not be re-derived from the raw message" };
  }
  if (det.amount !== intent.amount || det.unit !== intent.unit) {
    return { ok: false, reason: `amount/unit mismatch: message reads ${det.amount} ${det.unit}` };
  }

  // Authoritative intent uses the deterministic (re-derived) values.
  return {
    ok: true,
    intent: { action: det.action, asset: asset.symbol, amount: det.amount, unit: det.unit, confidence: intent.confidence },
  };
}
