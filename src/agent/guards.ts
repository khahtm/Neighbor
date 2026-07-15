import { IntentSchema, type Intent } from "./intent-schema";
import type { LlmResult } from "./gateway";
import { deterministicParse } from "./deterministic-parse";
import { resolveAsset } from "@/chain/token-registry";
import type { ChainEnv } from "@/chain/chains";

export type GuardOutcome =
  | { status: "ok"; intent: Intent }
  | { status: "clarify"; reason: string }
  | { status: "reject"; reason: string };

/**
 * Recover the intent JSON from an LLM response, tolerating the known local-model failure modes
 * (red-team C10): tool call as a proper tool_call, OR emitted as text with finish_reason=stop.
 */
function salvageArgs(result: LlmResult): string | null {
  const call = result.toolCalls.find((t) => t.name === "submit_intent");
  if (call?.arguments) return call.arguments;
  // Salvage: model put the tool call (or JSON) in content instead of tool_calls.
  const match = result.content.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/**
 * Validate the model output and reconcile it against the deterministic parse. The deterministic
 * values are authoritative for amount/asset/action; any mismatch forces a clarify rather than
 * executing a possibly-injected or hallucinated trade (red-team C11).
 */
export function reconcile(
  rawText: string,
  result: LlmResult,
  env: ChainEnv,
  confidenceThreshold: number,
): GuardOutcome {
  const argsRaw = salvageArgs(result);
  if (!argsRaw) return { status: "clarify", reason: "Could not read a structured intent. Please rephrase." };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(argsRaw);
  } catch {
    return { status: "clarify", reason: "Malformed intent from model. Please rephrase." };
  }

  const parsed = IntentSchema.safeParse(parsedJson);
  if (!parsed.success) return { status: "clarify", reason: "Intent did not match the expected shape." };
  const llm = parsed.data;

  // Asset must exist in the registry (never trust an LLM-invented symbol/address).
  const asset = resolveAsset(env, llm.asset);
  if (!asset) return { status: "reject", reason: `Unknown or unsupported asset: ${llm.asset}.` };

  if (typeof llm.confidence === "number" && llm.confidence < confidenceThreshold) {
    return { status: "clarify", reason: "Not confident enough — please restate the trade." };
  }

  const det = deterministicParse(rawText, env);

  // Asset: deterministic must independently resolve to the same symbol.
  if (!det.asset || det.asset.toUpperCase() !== asset.symbol.toUpperCase()) {
    return { status: "clarify", reason: "Which asset do you mean? I couldn't confirm it from your message." };
  }
  // Action (trade direction) is fund-critical: require an independent read, never trust the model's
  // buy/sell alone (a prompt-injected intent could flip it — C11).
  if (!det.action) {
    return { status: "clarify", reason: "Buy or sell? Say the direction explicitly." };
  }
  if (det.action !== llm.action) {
    return { status: "clarify", reason: "Buy or sell? Your message and the parse disagree." };
  }
  // Amount: must be independently readable and equal — deterministic value is authoritative.
  if (!det.amount || det.unit === null) {
    return { status: "clarify", reason: "How much? I couldn't read the amount from your message." };
  }
  if (det.amount !== llm.amount || det.unit !== llm.unit) {
    return { status: "clarify", reason: `Confirm the amount: I read ${det.amount} ${det.unit}.` };
  }

  // Authoritative intent uses the deterministic amount/asset/action.
  return {
    status: "ok",
    intent: {
      action: det.action ?? llm.action,
      asset: asset.symbol,
      amount: det.amount,
      unit: det.unit,
      confidence: llm.confidence,
    },
  };
}
