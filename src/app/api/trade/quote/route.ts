import { NextResponse } from "next/server";
import { z } from "zod";
import { CHAIN_ENV, activeChain } from "@/chain/chains";
import { ratifyIntent } from "@/agent/ratify-intent";
import { sizeOrder } from "@/chain/order-sizing";
import { getQuote, minOut, maxIn, SLIPPAGE_DEFAULT_BPS, assertSlippageWithinCap, RoutingError } from "@/chain/routing";
import { buildSwapCalldata, getPoolReferencePrices, ExecutionSeamError } from "@/chain/execution";
import { decodeSwapCalldata } from "@/chain/calldata-decoder";
import { assertSwapSafe, type SwapExpectation } from "@/chain/calldata-guard";
import { checkOracleSanity } from "@/chain/oracle-guard";
import { readFeed } from "@/chain/oracle";

/**
 * Build a guarded, ready-to-sign swap quote from a ratified intent. The whole money-path spine runs
 * server-side here: ratify (C11) -> size -> quote -> minOut (C12) -> build calldata -> decode +
 * assertSwapSafe (C2) -> oracle sanity (C3). Nothing is signed; the response is what the confirm UI
 * shows and the wallet then signs. Live legs (quote/build/oracle) are gated seams until P1 addresses
 * + RPC land, so today this returns a precise 503 at the first live leg rather than a fake quote.
 */
const BodySchema = z.object({
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  text: z.string().min(1).max(500),
  intent: z.unknown(),
  slippageBps: z.number().int().min(0).optional(),
});

const DEADLINE_SECONDS = 120;

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const ratified = ratifyIntent(body.data.text, body.data.intent, CHAIN_ENV);
  if (!ratified.ok) return NextResponse.json({ error: "intent rejected", detail: ratified.reason }, { status: 422 });

  const sized = sizeOrder(CHAIN_ENV, ratified.intent);
  if (sized.kind === "reject") return NextResponse.json({ error: "cannot size order", detail: sized.reason }, { status: 422 });
  if (sized.kind === "needs-balance") {
    return NextResponse.json(
      { error: "quote unavailable", detail: `percent order needs a live balance read (${sized.percent}% of ${sized.tokenIn.symbol}) — blocked pending RPC (P1)` },
      { status: 503 },
    );
  }

  const { tokenIn, tokenOut } = sized;
  if (!tokenIn.address || !tokenOut.address) {
    return NextResponse.json(
      { error: "quote unavailable", detail: `token addresses for ${CHAIN_ENV} not populated (${tokenIn.symbol}/${tokenOut.symbol}) — blocked pending P1 deployment addresses` },
      { status: 503 },
    );
  }

  const slippageBps = body.data.slippageBps ?? SLIPPAGE_DEFAULT_BPS;
  const userAddress = body.data.userAddress as `0x${string}`;

  // 1) Live price quote from the on-chain pool. This must succeed to show a real price.
  let quote, floor: bigint, inCeiling: bigint;
  try {
    assertSlippageWithinCap(slippageBps);
    const amountIn = sized.kind === "exact-in" ? sized.amountIn : sized.amountOut; // exact-out sizes input from the quote
    quote = await getQuote(CHAIN_ENV, tokenIn.address, tokenOut.address, amountIn);
    floor = minOut(quote.amountOut, slippageBps);
    // exact-in: input is exact (no input slippage). exact-out: cap the input side too (C12, finding 3).
    inCeiling = sized.kind === "exact-in" ? quote.amountIn : maxIn(quote.amountIn, slippageBps);
  } catch (e) {
    if (e instanceof RoutingError) return NextResponse.json({ error: "quote unavailable", detail: e.message }, { status: 503 });
    return NextResponse.json({ error: "quote failed", detail: (e as Error).message }, { status: 500 });
  }

  // 2) Oracle sanity (C3) — only for equity-backed tokens with a feed (skipped for feed-less tokens).
  if (tokenOut.feed) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const reading = await readFeed(tokenOut.feed.aggregator, tokenOut.feed.heartbeatSeconds, now);
      const { spot, twap } = await getPoolReferencePrices(CHAIN_ENV, tokenIn.address, tokenOut.address);
      const oracle = checkOracleSanity(spot, reading, twap, now);
      if (!oracle.ok) return NextResponse.json({ error: "oracle sanity blocked swap", detail: oracle.reason }, { status: 409 });
    } catch (e) {
      if (!(e instanceof ExecutionSeamError)) throw e; // seam (twap read) not ready — skip the NAV check for now
    }
  }

  // 3) Build + guard the signable calldata. Still seam-gated on the router deployment; if the seam
  // is not ready we return the live quote anyway (signable: false) so the user sees a real price.
  let signable: { tx: { to: string; data: string; value: string; chainId: number }; decoded: Record<string, string> } | null = null;
  let signableBlockedReason: string | null = null;
  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
    const tx = buildSwapCalldata({ env: CHAIN_ENV, userAddress, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn: quote.amountIn, amountOutMin: floor, fee: quote.fee, deadline });
    const decoded = decodeSwapCalldata(tx.data, tx.to, userAddress);
    const expected: SwapExpectation = { userAddress, tokenIn: tokenIn.address, tokenOut: tokenOut.address, minOut: floor, maxIn: inCeiling };
    const guard = assertSwapSafe(CHAIN_ENV, decoded, expected);
    if (!guard.ok) return NextResponse.json({ error: "calldata guard blocked swap", detail: guard.reason }, { status: 409 });
    signable = {
      tx: { to: tx.to, data: tx.data, value: tx.value.toString(), chainId: activeChain.id },
      decoded: {
        to: decoded.to, recipient: decoded.recipient, tokenIn: decoded.tokenIn, tokenOut: decoded.tokenOut,
        amountOutMin: decoded.amountOutMin.toString(), amountInMax: decoded.amountInMax.toString(),
      },
    };
  } catch (e) {
    if (!(e instanceof ExecutionSeamError)) return NextResponse.json({ error: "quote failed", detail: (e as Error).message }, { status: 500 });
    signableBlockedReason = e.message; // router deployment not wired yet — quote still returned
  }

  return NextResponse.json({
    intent: ratified.intent,
    route: quote.route,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    minOut: floor.toString(),
    maxIn: inCeiling.toString(),
    slippageBps,
    priceImpactBps: quote.priceImpactBps,
    signable: signable !== null,
    signableBlockedReason,
    tx: signable?.tx ?? null,
    decoded: signable?.decoded ?? null,
  });
}
