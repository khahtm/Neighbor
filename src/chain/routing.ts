import type { ChainEnv } from "./chains";
import { publicClient } from "./client";
import { dexConfig } from "./dex-config";

/**
 * Swap routing + slippage math. Uniswap is the primary (and only assumed) router on Robinhood
 * Chain (plan spike D). This module owns the DETERMINISTIC parts of routing — slippage bounds and
 * minimum-out computation — which are unit-testable offline and independent of any live RPC.
 *
 * The live `getQuote()` (Uniswap Quoter read) is a thin seam: it is intentionally blocked until the
 * router/quoter deployment addresses (router-allowlist.ts) and an RPC endpoint are populated
 * (P1 resources). Keeping the math here separate means the guard-critical logic ships + is tested
 * now, while only the network call waits on external inputs.
 */

/** Slippage thresholds (bps) — concrete values from the P1 spike (plan red-team C15). */
export const SLIPPAGE_DEFAULT_BPS = 100; // 1.0% default guard
export const SLIPPAGE_MAX_BPS = 300; // 3.0% hard cap — reject above this on thin young-chain pools
const BPS_DENOM = 10_000n;

export interface Quote {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint; // quoted output at current pool state
  fee: number; // pool fee tier the quote resolved (fed to buildSwapCalldata so execute hits the same pool)
  priceImpactBps: number; // informational; not the slippage guard
  route: string; // human-readable route description for the confirm dialog
}

export class RoutingError extends Error {}

/** Reject slippage above the hard cap before it is ever used to size a swap (C12). */
export function assertSlippageWithinCap(bps: number): void {
  if (!Number.isFinite(bps) || bps < 0) throw new RoutingError(`invalid slippage ${bps}`);
  if (bps > SLIPPAGE_MAX_BPS) {
    throw new RoutingError(`slippage ${bps}bps exceeds cap ${SLIPPAGE_MAX_BPS}bps`);
  }
}

/**
 * Minimum acceptable output for a swap given the quoted output and a slippage tolerance.
 * This is the value that MUST be encoded as `amountOutMin` in the swap calldata (C12): the guard
 * later asserts the signed calldata's amountOutMin is >= this number, so MEV/sandwich cannot push
 * the fill below it. Uses floor division — always rounds against the user's favour (safe).
 */
export function minOut(quotedOut: bigint, slippageBps: number): bigint {
  assertSlippageWithinCap(slippageBps);
  if (quotedOut < 0n) throw new RoutingError("quotedOut must be >= 0");
  return (quotedOut * (BPS_DENOM - BigInt(slippageBps))) / BPS_DENOM;
}

/**
 * Maximum acceptable INPUT for an exact-output swap given the quoted input and a slippage tolerance.
 * This is the value that MUST be encoded as `amountInMax` (the guard asserts the signed calldata's
 * amountInMax is <= this, so MEV cannot inflate the input side of a "buy N tokens" order — the
 * input-side analogue of minOut). Ceil division — always rounds against the user's favour (safe).
 */
export function maxIn(quotedIn: bigint, slippageBps: number): bigint {
  assertSlippageWithinCap(slippageBps);
  if (quotedIn < 0n) throw new RoutingError("quotedIn must be >= 0");
  const num = quotedIn * (BPS_DENOM + BigInt(slippageBps));
  return (num + BPS_DENOM - 1n) / BPS_DENOM; // ceil
}

const ZERO = "0x0000000000000000000000000000000000000000";
const Q192 = 1n << 192n;

const FACTORY_ABI = [
  { name: "getPool", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] },
] as const;
const POOL_ABI = [
  { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    name: "slot0", type: "function", stateMutability: "view", inputs: [],
    outputs: [
      { type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" },
    ],
  },
] as const;

/**
 * Live quote from the on-chain Uniswap V3 pool. Resolves a pool via the env's factory (probing fee
 * tiers), reads slot0's sqrtPriceX96, and computes the output at the current SPOT price minus the
 * pool fee. This is a spot quote — it ignores tick-liquidity depth, so it is accurate for small
 * sizes and only an estimate for large ones (a real Quoter/depth sim is the follow-up; see phase
 * B2). Assumes 18-decimal tokens (true for the current registry). BLOCKED (throws) when the env has
 * no configured factory (e.g. mainnet until populated).
 */
export async function getQuote(env: ChainEnv, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint): Promise<Quote> {
  const cfg = dexConfig(env);
  if (!cfg.v3Factory) throw new RoutingError(`getQuote blocked: no V3 factory configured for ${env}`);

  let pool = ZERO as string;
  let feeUsed = 0;
  for (const fee of cfg.feeTiers) {
    const p = (await publicClient.readContract({ address: cfg.v3Factory, abi: FACTORY_ABI, functionName: "getPool", args: [tokenIn, tokenOut, fee] })) as string;
    if (p && p.toLowerCase() !== ZERO) { pool = p; feeUsed = fee; break; }
  }
  if (pool === ZERO) throw new RoutingError(`no V3 pool for ${tokenIn}/${tokenOut} on ${env}`);

  const [token0, slot0] = await Promise.all([
    publicClient.readContract({ address: pool as `0x${string}`, abi: POOL_ABI, functionName: "token0" }) as Promise<string>,
    publicClient.readContract({ address: pool as `0x${string}`, abi: POOL_ABI, functionName: "slot0" }) as Promise<readonly unknown[]>,
  ]);
  const sqrtP = slot0[0] as bigint;
  if (sqrtP <= 0n) throw new RoutingError("pool not initialized (sqrtPrice = 0)");

  const inIsToken0 = token0.toLowerCase() === tokenIn.toLowerCase();
  // price(token1/token0) = sqrtP^2 / 2^192. token0->token1 multiplies; token1->token0 divides.
  const gross = inIsToken0 ? (amountIn * sqrtP * sqrtP) / Q192 : (amountIn * Q192) / (sqrtP * sqrtP);
  const amountOut = (gross * BigInt(1_000_000 - feeUsed)) / 1_000_000n; // subtract pool fee

  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    fee: feeUsed,
    priceImpactBps: 0, // spot quote — depth not modeled
    route: `Uniswap V3 ${feeUsed / 10_000}% (spot)`,
  };
}
