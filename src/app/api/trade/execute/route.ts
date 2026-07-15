import { NextResponse } from "next/server";
import { z } from "zod";
import { CHAIN_ENV, activeChain } from "@/chain/chains";
import { ratifyIntent } from "@/agent/ratify-intent";
import { sizeOrder } from "@/chain/order-sizing";
import { guardSignedSwap } from "@/chain/signed-tx-guard";
import type { SwapExpectation } from "@/chain/calldata-guard";
import { broadcastRawTx, ExecutionSeamError } from "@/chain/execution";
import { prisma } from "@/lib/prisma";
import { isExecutionPaused } from "@/lib/kill-switch";
import { evaluateExecutionPolicy } from "@/lib/compliance/execution-policy";
import { countryFromHeaders } from "@/lib/compliance/geo";
import { hasAcceptedTos } from "@/lib/compliance/tos";

/**
 * Execute a swap the user already confirmed + signed (non-custodial: the wallet signs, we relay).
 *
 * The guard runs on the EXACT signed tx that will be broadcast (not a separate unsigned field): we
 * re-ratify the intent, then `guardSignedSwap` parses `signedRawTx`, decodes its calldata, validates
 * the whole command set, and asserts the swap-safety invariant (C2). The nonce + hash come from those
 * same signed bytes, so per C4 we persist BEFORE broadcasting and de-dupe on the hash — a re-POST of
 * the same signed tx returns the existing row instead of creating a second swap. Compliance (C8/C15:
 * kill-switch, cross-env, geo, ToS) gates ahead of any chain work. broadcast is a live seam.
 */
const BodySchema = z.object({
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  userId: z.string().min(1),
  text: z.string().min(1).max(500),
  intent: z.unknown(),
  minOut: z.string().regex(/^\d+$/),
  maxIn: z.string().regex(/^\d+$/),
  signedRawTx: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Compliance gate before any chain work (C8/C15): kill-switch, cross-env, geo deterrent. No DB.
  const policy = evaluateExecutionPolicy({
    paused: isExecutionPaused(),
    requestChainEnv: CHAIN_ENV,
    txChainEnv: CHAIN_ENV,
    country: countryFromHeaders(req.headers),
  });
  if (!policy.allowed) return NextResponse.json({ error: "execution not allowed", detail: policy.reason }, { status: policy.status });

  const ratified = ratifyIntent(body.data.text, body.data.intent, CHAIN_ENV);
  if (!ratified.ok) return NextResponse.json({ error: "intent rejected", detail: ratified.reason }, { status: 422 });

  const sized = sizeOrder(CHAIN_ENV, ratified.intent);
  if (sized.kind === "reject") return NextResponse.json({ error: "cannot size order", detail: sized.reason }, { status: 422 });
  if (!("tokenIn" in sized) || !sized.tokenIn.address || !sized.tokenOut.address) {
    return NextResponse.json(
      { error: "execute unavailable", detail: `token addresses for ${CHAIN_ENV} not populated — blocked pending P1 deployment addresses` },
      { status: 503 },
    );
  }

  // Guard the EXACT signed tx that will be relayed (C2). nonce + hash are extracted from it (C4).
  const userAddress = body.data.userAddress as `0x${string}`;
  const expected: SwapExpectation = {
    userAddress,
    tokenIn: sized.tokenIn.address,
    tokenOut: sized.tokenOut.address,
    minOut: BigInt(body.data.minOut),
    maxIn: BigInt(body.data.maxIn),
  };
  const guard = guardSignedSwap(CHAIN_ENV, body.data.signedRawTx as `0x${string}`, expected, activeChain.id);
  if (!guard.ok) return NextResponse.json({ error: "signed tx rejected", detail: guard.reason }, { status: guard.status });

  try {
    // ToS/disclaimer gate (C8) — needs the user row, still before any chain work.
    const user = await prisma.user.findUnique({ where: { id: body.data.userId }, select: { tosAcceptedAt: true } });
    if (!user) return NextResponse.json({ error: "unknown user" }, { status: 404 });
    if (!hasAcceptedTos(user.tosAcceptedAt)) {
      return NextResponse.json({ error: "terms not accepted", detail: "accept the risk disclaimer before trading" }, { status: 403 });
    }

    // Idempotency (C4): the signed-tx hash is the key. A re-POST returns the existing row, never a
    // second swap. Persist BEFORE broadcasting so a crash after send is still tracked by its nonce.
    const existing = await prisma.tx.findUnique({ where: { hash: guard.hash } });
    if (existing) {
      return NextResponse.json({ txId: existing.id, intentId: existing.intentId, hash: guard.hash, state: existing.state, idempotent: true });
    }

    const intent = await prisma.intent.create({
      data: {
        userId: body.data.userId,
        rawText: body.data.text,
        action: ratified.intent.action,
        assetSymbol: ratified.intent.asset,
        amount: ratified.intent.amount,
        unit: ratified.intent.unit,
        confidence: ratified.intent.confidence ?? null,
        status: "confirmed",
      },
    });
    const tx = await prisma.tx.create({
      data: { userId: body.data.userId, intentId: intent.id, chainEnv: CHAIN_ENV, nonce: guard.nonce, hash: guard.hash, state: "swap_pending" },
    });

    await broadcastRawTx(CHAIN_ENV, body.data.signedRawTx as `0x${string}`);
    return NextResponse.json({ txId: tx.id, intentId: intent.id, hash: guard.hash, state: "swap_pending" });
  } catch (e) {
    if (e instanceof ExecutionSeamError) {
      return NextResponse.json({ error: "execute blocked pending live resources", detail: (e as Error).message }, { status: 503 });
    }
    // Most likely DATABASE_URL not configured yet.
    return NextResponse.json({ error: "execute failed", detail: (e as Error).message }, { status: 503 });
  }
}
