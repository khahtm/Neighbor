import type { ChainEnv } from "./chains";
import { isAllowedRouter } from "./router-allowlist";

/**
 * Calldata safety guard — the last deterministic gate before a user signs a swap (plan red-team C2).
 *
 * A router (or a compromised/spoofed router API) hands back calldata that WE then ask the user to
 * sign. Checking price alone is not enough: the calldata could redirect the output to an attacker,
 * target a non-router contract, or set amountOutMin=0 to invite a sandwich. So before signing we
 * decode the swap and assert its invariants against what the user actually confirmed.
 *
 * This module holds the INVARIANT CHECK over a normalized `DecodedSwap`. Producing that struct from
 * a specific router's calldata (Uniswap Universal Router / SwapRouter02 encoding) is a separate,
 * router-version-specific decoder that lands with the real deployment addresses — but the security
 * invariant itself is fixed and fully testable now.
 */

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Normalized view of a swap, extracted from router calldata by a per-router decoder. */
export interface DecodedSwap {
  to: `0x${string}`; // tx.to — the contract the signed tx targets
  recipient: `0x${string}`; // who receives the output tokens
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountOutMin: bigint; // slippage floor (min output) encoded in the calldata
  amountInMax: bigint; // input ceiling encoded in the calldata (exact input, or exact-out max input)
}

/** What the user confirmed — the guard asserts the calldata cannot deviate from this. */
export interface SwapExpectation {
  userAddress: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  minOut: bigint; // from routing.minOut() at the confirmed slippage — output must be >= this
  maxIn: bigint; // confirmed input ceiling — the calldata's input must be <= this (exact-out sandwich)
}

export type SwapGuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Assert a decoded swap matches the confirmed expectation. Any mismatch is a hard block — we never
 * downgrade to a warning, because every failure here is a fund-loss vector:
 *  - to not in allowlist   -> calldata targets an unknown/malicious contract
 *  - recipient != user     -> output redirected away from the user (theft)
 *  - token mismatch        -> swapping a different asset than confirmed
 *  - amountOutMin < minOut -> sandwich/MEV room on the OUTPUT the user did not accept (C12)
 *  - amountInMax > maxIn   -> sandwich room on the INPUT (exact-out) the user did not accept (C12)
 */
export function assertSwapSafe(
  env: ChainEnv,
  decoded: DecodedSwap,
  expected: SwapExpectation,
  isAllowed: (env: ChainEnv, to: string) => boolean = isAllowedRouter,
): SwapGuardResult {
  if (!isAllowed(env, decoded.to)) {
    return { ok: false, reason: `router ${decoded.to} not in allowlist` };
  }
  if (!eqAddr(decoded.recipient, expected.userAddress)) {
    return { ok: false, reason: `recipient ${decoded.recipient} is not the user's wallet` };
  }
  if (!eqAddr(decoded.tokenIn, expected.tokenIn)) {
    return { ok: false, reason: `tokenIn ${decoded.tokenIn} != confirmed ${expected.tokenIn}` };
  }
  if (!eqAddr(decoded.tokenOut, expected.tokenOut)) {
    return { ok: false, reason: `tokenOut ${decoded.tokenOut} != confirmed ${expected.tokenOut}` };
  }
  if (decoded.amountOutMin < expected.minOut) {
    return { ok: false, reason: `amountOutMin ${decoded.amountOutMin} below confirmed floor ${expected.minOut}` };
  }
  if (decoded.amountInMax > expected.maxIn) {
    return { ok: false, reason: `amountInMax ${decoded.amountInMax} above confirmed ceiling ${expected.maxIn}` };
  }
  return { ok: true };
}
