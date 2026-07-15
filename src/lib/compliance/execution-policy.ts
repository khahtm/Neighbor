import type { ChainEnv } from "@/chain/chains";
import { isRestrictedJurisdiction } from "./restricted-set";

/**
 * Pure, no-I/O execution policy gate for the trade execute path (red-team C8/C15). Bundles the
 * checks that need NO database read so they can run first and be fully unit-tested:
 *   - kill-switch paused        -> 503
 *   - cross-env execute refused -> 409  (a tx targeting a different env than this process runs; C15)
 *   - restricted jurisdiction   -> 451  (IP DETERRENT only — not a compliance control; see restricted-set)
 *
 * ToS acceptance is checked separately (it needs a user row from the DB) — see compliance/tos.
 * `country` is null when geolocation is undetermined; per the MVP deterrent model an undetermined
 * country is NOT blocked here (documented trade-off), and mainnet stays legal-gated regardless.
 */

export interface ExecutionPolicyInput {
  paused: boolean;
  requestChainEnv: ChainEnv;
  txChainEnv: ChainEnv;
  country: string | null;
}

export type PolicyDecision = { allowed: true } | { allowed: false; status: number; reason: string };

export function evaluateExecutionPolicy(i: ExecutionPolicyInput): PolicyDecision {
  if (i.paused) {
    return { allowed: false, status: 503, reason: "execution is paused (kill-switch)" };
  }
  if (i.txChainEnv !== i.requestChainEnv) {
    return { allowed: false, status: 409, reason: `cross-env execute refused (${i.txChainEnv} tx on ${i.requestChainEnv})` };
  }
  if (i.country && isRestrictedJurisdiction(i.country)) {
    return { allowed: false, status: 451, reason: `restricted jurisdiction: ${i.country}` };
  }
  return { allowed: true };
}
