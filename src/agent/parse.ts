import { callLlm, isConfigured, isLocalLlmEndpoint, type ChatMessage } from "./gateway";
import { reconcile, type GuardOutcome } from "./guards";
import type { ChainEnv } from "@/chain/chains";

/** Confidence threshold (red-team C15 concrete value from P1 spike note). */
export const CONFIDENCE_THRESHOLD = 0.75;

const SYSTEM_PROMPT = [
  "You convert a user's message into a single trade intent by calling submit_intent.",
  "Actions: buy, sell, swap. Use the exact ticker the user names.",
  "amount is digits only; unit is USD, token, or percent.",
  "Never invent an asset the user did not mention. If unclear, still call submit_intent with your best guess and a low confidence.",
].join(" ");

/**
 * NL → structured intent. The model is only a proposer; guards.reconcile() cross-checks against a
 * deterministic parse and the token registry before anything is presented for confirmation.
 * No execution happens here (Phase 4 owns execution).
 */
export async function parseIntent(rawText: string, env: ChainEnv): Promise<GuardOutcome> {
  if (!isConfigured()) {
    return { status: "clarify", reason: "LLM endpoint not configured yet (set LLM_BASE_URL/LLM_MODEL)." };
  }
  // C9 hard gate: on mainnet the money-path LLM MUST be local — never send order-flow to a hosted
  // provider (a hosted model is allowed on testnet for dev only). Fails closed.
  if (env === "mainnet" && !isLocalLlmEndpoint()) {
    return {
      status: "reject",
      reason: "Money-path LLM must be a local endpoint on mainnet (C9). Configure a local model before mainnet cutover.",
    };
  }
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: rawText },
  ];
  let result;
  try {
    result = await callLlm(messages);
  } catch (e) {
    // Local model down/unreachable — do NOT silently fall back to an external provider (C9).
    return { status: "clarify", reason: `Model unavailable: ${(e as Error).message}` };
  }
  return reconcile(rawText, result, env, CONFIDENCE_THRESHOLD);
}
