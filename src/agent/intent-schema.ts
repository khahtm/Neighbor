import { z } from "zod";

/** Trading actions supported in the swap-only MVP (automations are deferred). */
export const ACTIONS = ["buy", "sell", "swap"] as const;
export type Action = (typeof ACTIONS)[number];

export const UNITS = ["USD", "token", "percent"] as const;
export type Unit = (typeof UNITS)[number];

/**
 * Structured trade intent. The LLM proposes this, but the numeric `amount`/`asset` are
 * re-derived deterministically from the raw user text and win on any mismatch (red-team C11).
 */
export const IntentSchema = z.object({
  action: z.enum(ACTIONS),
  asset: z.string().min(1).max(12), // ticker symbol, validated against the registry downstream
  amount: z.string().regex(/^\d+(\.\d+)?$/), // decimal string
  unit: z.enum(UNITS),
  confidence: z.number().min(0).max(1).optional(),
});

export type Intent = z.infer<typeof IntentSchema>;
