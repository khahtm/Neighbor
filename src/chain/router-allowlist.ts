import type { ChainEnv } from "./chains";

/**
 * Router allowlist — the set of contract addresses a swap transaction is permitted to target.
 * Before a user signs, the built calldata's `tx.to` MUST be in this allowlist, and the decoded
 * receiver must equal the user's own wallet (plan red-team C2). This defends against a
 * compromised/spoofed router API returning calldata that redirects output to an attacker.
 *
 * Robinhood Chain testnet has no publicly deployed Uniswap periphery bound to the factory that
 * actually holds liquidity (0x911b4000…), so we deploy our own minimal `NeighborSwapRouter` and
 * allow only it. Its calldata is `exactInputSingle(...)`, decoded by the Neighbor decoder — not the
 * Universal Router `execute` shape (see calldata-decoder.ts selector dispatch).
 *
 * Mainnet stays empty until Uniswap's official Robinhood Chain deployment addresses are confirmed
 * (source of truth = Uniswap docs) — execute remains blocked on mainnet by design.
 */

export interface RouterEntry {
  name: string;
  address: `0x${string}`;
}

const TESTNET_ROUTERS: RouterEntry[] = [
  { name: "NeighborSwapRouter", address: "0x9C286361EF9DFFAE49F53eFf3afe1d8591c833a5" },
];

const MAINNET_ROUTERS: RouterEntry[] = [
  // { name: "UniversalRouter", address: "0x..." },
];

export function routersFor(env: ChainEnv): RouterEntry[] {
  return env === "mainnet" ? MAINNET_ROUTERS : TESTNET_ROUTERS;
}

export function isAllowedRouter(env: ChainEnv, to: string): boolean {
  const t = to.toLowerCase();
  return routersFor(env).some((r) => r.address.toLowerCase() === t);
}
