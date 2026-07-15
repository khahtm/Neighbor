import { NextResponse } from "next/server";
import { CHAIN_ENV } from "@/chain/chains";
import { registryFor } from "@/chain/token-registry";
import { erc20BalanceOf } from "@/chain/client";

/**
 * Portfolio holdings read DIRECTLY on-chain (red-team C15 — no indexer in the MVP). Loops the token
 * registry and reads balanceOf per token. Tokens without a populated address for this env are skipped
 * (reported as `unconfigured`) rather than faked, so today — before P1 addresses land — this returns
 * an empty holdings list plus the count still awaiting addresses. tx history is deferred to a later
 * step; holdings are the Phase 6 acceptance surface.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "valid address required" }, { status: 400 });
  }

  const registry = registryFor(CHAIN_ENV);
  const tradeable = Object.values(registry).filter((t) => t.address);
  const unconfigured = Object.keys(registry).length - tradeable.length;

  try {
    const holdings = await Promise.all(
      tradeable.map(async (t) => ({
        symbol: t.symbol,
        decimals: t.decimals,
        kind: t.kind,
        balance: (await erc20BalanceOf(t.address!, address as `0x${string}`)).toString(),
      })),
    );
    return NextResponse.json({
      address,
      chainEnv: CHAIN_ENV,
      holdings: holdings.filter((h) => h.balance !== "0"),
      unconfiguredTokens: unconfigured, // still awaiting P1 deployment addresses
    });
  } catch (e) {
    return NextResponse.json({ error: "portfolio read failed", detail: (e as Error).message }, { status: 503 });
  }
}
