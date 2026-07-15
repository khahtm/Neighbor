/**
 * OpenAI-compatible LLM gateway. Money-path uses a LOCAL self-hosted endpoint only
 * (Ollama / vLLM), so trade intents (order-flow) never leave to an external provider (red-team C9).
 * Dependency-free: talks the /chat/completions wire format over fetch.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface LlmToolCall {
  name: string;
  arguments: string; // raw JSON string as emitted by the model
}

export interface LlmResult {
  finishReason: string | null;
  toolCalls: LlmToolCall[];
  content: string; // assistant text content (used for tool-call-as-text salvage)
}

const BASE_URL = process.env.LLM_BASE_URL ?? "";
const MODEL = process.env.LLM_MODEL ?? "";
const API_KEY = process.env.LLM_API_KEY ?? "not-needed-for-local";

export function isConfigured(): boolean {
  return Boolean(BASE_URL && MODEL);
}

/**
 * True if the configured LLM endpoint is a LOCAL host (loopback / .local / private LAN). The
 * money-path must run local on mainnet so trade order-flow never leaves to an external provider
 * (red-team C9). A hosted provider (e.g. DeepSeek) is allowed on testnet for dev only; the mainnet
 * gate in parse.ts enforces local there. Fails closed (false) on an unparseable URL.
 */
export function isLocalLlmEndpoint(): boolean {
  try {
    const h = new URL(BASE_URL).hostname.toLowerCase();
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "0.0.0.0" ||
      h.endsWith(".local") ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return false;
  }
}

/** Single tool the model may call to emit a structured trade intent. */
export const INTENT_TOOL = {
  type: "function",
  function: {
    name: "submit_intent",
    description: "Emit the user's trade intent as structured data.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["buy", "sell", "swap"] },
        asset: { type: "string", description: "ticker symbol, e.g. TSLA" },
        amount: { type: "string", description: "decimal amount, digits only" },
        unit: { type: "string", enum: ["USD", "token", "percent"] },
        confidence: { type: "number" },
      },
      required: ["action", "asset", "amount", "unit"],
    },
  },
} as const;

export async function callLlm(messages: ChatMessage[]): Promise<LlmResult> {
  if (!isConfigured()) {
    throw new Error("LLM not configured: set LLM_BASE_URL and LLM_MODEL (local endpoint).");
  }
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: [INTENT_TOOL],
      tool_choice: "auto",
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> };
    }>;
  };
  const choice = data.choices?.[0];
  const toolCalls: LlmToolCall[] = (choice?.message?.tool_calls ?? [])
    .map((t) => ({ name: t.function?.name ?? "", arguments: t.function?.arguments ?? "" }))
    .filter((t) => t.name);
  return {
    finishReason: choice?.finish_reason ?? null,
    toolCalls,
    content: choice?.message?.content ?? "",
  };
}
