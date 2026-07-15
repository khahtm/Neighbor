import { parseTransaction, keccak256, getAddress } from "viem";
import type { ChainEnv } from "./chains";
import { decodeSwapCalldata } from "./calldata-decoder";
import { assertSwapSafe, type SwapExpectation } from "./calldata-guard";

/**
 * Guard the EXACT transaction that will be broadcast (review finding: guard/broadcast decoupling).
 *
 * The earlier flow decoded an unsigned `tx.data` field but relayed a separate `signedRawTx` — so the
 * guard proved nothing about what actually hit the chain. This parses the signed raw tx itself and
 * asserts the swap-safety invariant against the calldata + target INSIDE it. The returned nonce/hash
 * come from the same signed bytes, so they are the idempotency anchor (C4): persist before broadcast,
 * de-dupe on the hash, and a re-POST of the same signed tx cannot create a second swap.
 */
export type SignedSwapGuard =
  | { ok: true; hash: `0x${string}`; nonce: number; to: `0x${string}` }
  | { ok: false; status: number; reason: string };

export function guardSignedSwap(
  env: ChainEnv,
  signedRawTx: `0x${string}`,
  expected: SwapExpectation,
  expectedChainId: number,
  isAllowed?: (env: ChainEnv, to: string) => boolean,
): SignedSwapGuard {
  let parsed;
  try {
    parsed = parseTransaction(signedRawTx);
  } catch (e) {
    return { ok: false, status: 422, reason: `unparseable signed tx: ${(e as Error).message}` };
  }

  // Reject a tx signed for another chain (cross-chain replay).
  if (parsed.chainId !== undefined && parsed.chainId !== expectedChainId) {
    return { ok: false, status: 409, reason: `signed for chainId ${parsed.chainId}, expected ${expectedChainId}` };
  }
  if (typeof parsed.nonce !== "number") {
    return { ok: false, status: 422, reason: "signed tx has no nonce" };
  }
  if (!parsed.to || !parsed.data) {
    return { ok: false, status: 422, reason: "signed tx missing to/data" };
  }

  const to = getAddress(parsed.to);
  let decoded;
  try {
    decoded = decodeSwapCalldata(parsed.data as `0x${string}`, to, expected.userAddress);
  } catch (e) {
    return { ok: false, status: 422, reason: `undecodable calldata: ${(e as Error).message}` };
  }

  const guard = assertSwapSafe(env, decoded, expected, isAllowed);
  if (!guard.ok) return { ok: false, status: 409, reason: guard.reason };

  return { ok: true, hash: keccak256(signedRawTx), nonce: parsed.nonce, to };
}
