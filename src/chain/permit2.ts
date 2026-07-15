import type { ChainEnv } from "./chains";
import { ExecutionSeamError } from "./execution";

/**
 * Permit2 approve path (red-team C13: avoid a hanging allowance / approve-race / stuck retry).
 *
 * Instead of a per-token ERC-20 approve to each router, the user grants a ONE-TIME max approval of
 * each token to the canonical Permit2 contract, then authorizes individual spends via a signed
 * PermitSingle (EIP-712) that the router consumes in the same swap. This removes the separate
 * on-chain approve tx from the money path for every swap after the first per-token approval.
 *
 * The Permit2 contract address is the same on every EVM chain (deterministic deploy). The typed-data
 * builder here is pure/testable; reading the current Permit2 allowance needs RPC and is a seam.
 */

/** Canonical Permit2 deployment — identical across EVM chains. */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// Permit2 packs amount into uint160 and expiration/nonce into uint48.
export const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;

/**
 * Whether a fresh ERC-20 approve(token -> Permit2) is still required. Once the token's allowance to
 * Permit2 covers the spend, no more on-chain approves are needed — subsequent swaps are permit-only.
 */
export function needsPermit2Approval(currentAllowanceToPermit2: bigint, amountIn: bigint): boolean {
  return currentAllowanceToPermit2 < amountIn;
}

export interface PermitSingleValues {
  token: `0x${string}`;
  spender: `0x${string}`; // the router that will pull the tokens
  amount: bigint; // uint160
  expiration: number; // uint48 unix seconds
  nonce: number; // uint48 Permit2 allowance nonce
  sigDeadline: bigint;
}

/** Build the EIP-712 typed data for a Permit2 PermitSingle the wallet signs (no approve tx). */
export function buildPermitSingleTypedData(chainId: number, v: PermitSingleValues) {
  if (v.amount < 0n || v.amount > MAX_UINT160) throw new Error("permit amount exceeds uint160");
  if (v.expiration < 0 || BigInt(v.expiration) > MAX_UINT48) throw new Error("expiration exceeds uint48");
  return {
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
    },
    primaryType: "PermitSingle" as const,
    message: {
      details: { token: v.token, amount: v.amount, expiration: v.expiration, nonce: v.nonce },
      spender: v.spender,
      sigDeadline: v.sigDeadline,
    },
  };
}

/** Current token->Permit2 allowance. BLOCKED until RPC + token addresses (P1 resources). */
export function readPermit2Allowance(
  _env: ChainEnv,
  _token: `0x${string}`,
  _owner: `0x${string}`,
): Promise<bigint> {
  throw new ExecutionSeamError(
    "readPermit2Allowance blocked: populate token addresses and an RPC endpoint (P1 resources)",
  );
}
