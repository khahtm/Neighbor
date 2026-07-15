import type { ChainEnv } from "./chains";

/**
 * DEX deployment config per env. The V3 factory is the one whose pools actually hold the tradeable
 * liquidity on Robinhood Chain testnet (discovered on-chain: it created the funded USDC/TSLA pool
 * `0xFfEf1147…`). The testnet is a public sandbox with several look-alike factories; this is the one
 * bound to real pools. Mainnet factory/router are TBD (pulled from Uniswap's RH deployment later).
 */
export interface DexConfig {
  v3Factory: `0x${string}` | null;
  /** Swap router `buildSwapCalldata` targets. Testnet = our deployed NeighborSwapRouter (exactInputSingle). */
  router: `0x${string}` | null;
  feeTiers: number[]; // probed in order when resolving a pool
}

const TESTNET: DexConfig = {
  v3Factory: "0x911b4000d3422f482f4062a913885f7b035382df",
  router: "0x9C286361EF9DFFAE49F53eFf3afe1d8591c833a5", // NeighborSwapRouter, bound to the factory above
  feeTiers: [3000, 500, 10000, 100],
};

const MAINNET: DexConfig = {
  v3Factory: null, // Uniswap RH mainnet factory to be populated before mainnet
  router: null, // execute stays blocked on mainnet until an audited router is confirmed
  feeTiers: [3000, 500, 10000, 100],
};

export function dexConfig(env: ChainEnv): DexConfig {
  return env === "mainnet" ? MAINNET : TESTNET;
}
