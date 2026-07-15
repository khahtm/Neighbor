/**
 * Transaction state machine + finality policy (plan red-team C4/C15).
 *
 * Robinhood Chain is an Arbitrum Orbit L2 with a single Robinhood sequencer giving ~100ms soft
 * confirmation. Soft confirmation is NOT finality — a soft-confirmed tx can still be re-orged. So a
 * Tx is marked `confirmed` ONLY after a finality depth of confirmations; before that it stays
 * pending and a re-org drops it back to retryable. Idempotency is anchored on the on-chain nonce
 * (reserved + persisted before signing), so a retry reuses the nonce and the chain de-dupes.
 */

/** Mirrors the Tx.state column in prisma/schema.prisma. */
export type TxState =
  | "built"
  | "approve_pending"
  | "swap_pending"
  | "confirmed"
  | "failed"
  | "replaced";

/**
 * Finality depth before a tx is treated as settled. NOT an empirically verified number yet — the
 * P1 spike deferred reorg-depth measurement, so this is a deliberately conservative, env-overridable
 * default. It must be tuned against observed sequencer reorg behaviour before mainnet (do not treat
 * as a validated constant).
 */
export const FINALITY_DEPTH_BLOCKS = Number(process.env.FINALITY_DEPTH_BLOCKS ?? 12);

/** Allowed transitions. approve_pending is skipped when Permit2/EIP-2612 avoids a separate approve. */
const TRANSITIONS: Record<TxState, TxState[]> = {
  built: ["approve_pending", "swap_pending", "failed", "replaced"],
  approve_pending: ["swap_pending", "failed", "replaced"],
  swap_pending: ["confirmed", "failed", "replaced"],
  confirmed: [], // terminal
  failed: [], // terminal
  replaced: [], // terminal
};

export function canTransition(from: TxState, to: TxState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class TxStateError extends Error {}

export function assertTransition(from: TxState, to: TxState): void {
  if (!canTransition(from, to)) throw new TxStateError(`illegal tx transition ${from} -> ${to}`);
}

/** A tx is final only once it has at least the finality depth of confirmations. */
export function isFinal(confirmations: number, depth: number = FINALITY_DEPTH_BLOCKS): boolean {
  return confirmations >= depth;
}

/**
 * A soft-confirmed tx that then loses its confirmations to a re-org must NOT stay `confirmed`.
 * Returns true when a tx we treated as progressing has dropped below any confirmation (re-org),
 * meaning it should be re-driven (retry reuses the same nonce — chain-level idempotency).
 */
export function isReorged(previousConfirmations: number, currentConfirmations: number): boolean {
  return previousConfirmations > 0 && currentConfirmations === 0;
}

/**
 * A previously-final tx must be un-settled if it no longer meets the finality depth. This catches a
 * PARTIAL re-org (e.g. depth 12, confirmations drop 12 -> 3) — not only a full drop to zero — which a
 * bare `currentConfirmations === 0` check would miss and wrongly keep reporting as `confirmed`.
 */
export function shouldUnsettle(
  wasFinal: boolean,
  currentConfirmations: number,
  depth: number = FINALITY_DEPTH_BLOCKS,
): boolean {
  return wasFinal && !isFinal(currentConfirmations, depth);
}

/**
 * A swap stuck pending past a timeout should be cancelled/replaced by re-broadcasting at the SAME
 * nonce (replace-by-nonce), never left hanging and never re-sent at a new nonce (that risks a
 * double-execute). Only pending states are replaceable.
 */
export function shouldReplaceByNonce(state: TxState, secondsPending: number, maxPendingSeconds: number): boolean {
  const pending = state === "approve_pending" || state === "swap_pending";
  return pending && secondsPending >= maxPendingSeconds;
}
