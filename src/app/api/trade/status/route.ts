import { NextResponse } from "next/server";
import { CHAIN_ENV } from "@/chain/chains";
import { getConfirmations, ExecutionSeamError } from "@/chain/execution";
import { isFinal, shouldUnsettle, FINALITY_DEPTH_BLOCKS, type TxState } from "@/chain/tx-state";
import { prisma } from "@/lib/prisma";

/**
 * Report a tx's settlement state (red-team C4). Soft confirmation is not finality: a tx is only
 * `confirmed` after FINALITY_DEPTH_BLOCKS confirmations, and a previously-final tx that loses all
 * confirmations to a re-org is dropped back to pending for re-drive (retry reuses the same nonce).
 * `getConfirmations` is a live seam; `confirmedAt` stands in for the previous "had progressed" state.
 */
export async function GET(req: Request) {
  const txId = new URL(req.url).searchParams.get("txId");
  if (!txId) return NextResponse.json({ error: "txId required" }, { status: 400 });

  let tx;
  try {
    tx = await prisma.tx.findUnique({ where: { id: txId } });
  } catch (e) {
    return NextResponse.json({ error: "database unavailable", detail: (e as Error).message }, { status: 503 });
  }
  if (!tx) return NextResponse.json({ error: "unknown txId" }, { status: 404 });
  // Cross-env guard (C15): never report/drive a tx that belongs to a different chain env.
  if (tx.chainEnv !== CHAIN_ENV) {
    return NextResponse.json({ error: "cross-env tx refused", detail: `tx is ${tx.chainEnv}, process is ${CHAIN_ENV}` }, { status: 409 });
  }
  if (!tx.hash) return NextResponse.json({ txId, state: tx.state, confirmations: 0, final: false });

  try {
    const confirmations = await getConfirmations(CHAIN_ENV, tx.hash as `0x${string}`);
    const wasFinal = tx.confirmedAt !== null;
    const final = isFinal(confirmations);

    let state: TxState = tx.state as TxState;
    // A previously-final tx that no longer meets the finality depth was re-orged — a partial drop
    // (e.g. 12 -> 3), not only a full drop to 0, must un-settle it (finding: reorg-at-0-only).
    if (shouldUnsettle(wasFinal, confirmations)) {
      // Drop back to pending so it can be re-driven (retry reuses the same nonce — chain de-dupes).
      state = "swap_pending";
      await prisma.tx.update({ where: { id: tx.id }, data: { state, confirmedAt: null } });
    } else if (final && tx.state !== "confirmed") {
      state = "confirmed";
      await prisma.tx.update({ where: { id: tx.id }, data: { state, confirmedAt: new Date() } });
    }

    return NextResponse.json({ txId, state, confirmations, final, finalityDepth: FINALITY_DEPTH_BLOCKS });
  } catch (e) {
    if (e instanceof ExecutionSeamError) {
      return NextResponse.json({ error: "status blocked pending live resources", detail: (e as Error).message }, { status: 503 });
    }
    return NextResponse.json({ error: "status failed", detail: (e as Error).message }, { status: 500 });
  }
}
