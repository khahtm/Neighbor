import type { ChainEnv } from "./chains";

/**
 * Token registry — the ONLY source of tradeable assets. The LLM may never invent an address;
 * intents must resolve a symbol to a registry entry or be rejected (red-team C11). Neighbor is
 * token-general (not stock-only), so this holds any tradeable token per env.
 *
 * Quote/tokenIn asset differs by env: on mainnet it is USDG (Global Dollar); testnet has no USDG,
 * so the quote asset is USDC (verified on-chain). Addresses below are verified: testnet from the
 * Robinhood Chain Blockscout token list + on-chain symbol/decimals reads; mainnet from
 * docs.robinhood.com/chain/contracts. Decimals are 18 across these tokens (confirmed for the ones
 * exercised).
 */

export interface TokenMeta {
  symbol: string;
  name: string;
  decimals: number;
  address: `0x${string}` | null; // null = not yet populated for this env
  kind: "stablecoin" | "stock" | "etf" | "native-wrapped" | "token";
  /** Chainlink feed aggregator + heartbeat (seconds) when a price feed exists (equity-backed only). */
  feed?: { aggregator: `0x${string}`; heartbeatSeconds: number } | null;
}

type Registry = Record<string, TokenMeta>;

// Robinhood Chain TESTNET (chainId 46630) — verified on-chain.
const TESTNET: Registry = {
  USDC: { symbol: "USDC", name: "USD Coin", decimals: 18, address: "0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F", kind: "stablecoin" },
  mUSD: { symbol: "mUSD", name: "Mock USD", decimals: 18, address: "0xCc4225D5F36b26b211675E8d9B7f11511Ba58D2C", kind: "stablecoin" },
  TSLA: { symbol: "TSLA", name: "Tesla", decimals: 18, address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", kind: "stock", feed: null },
  AMZN: { symbol: "AMZN", name: "Amazon", decimals: 18, address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", kind: "stock", feed: null },
  WETH: { symbol: "WETH", name: "Wrapped Ether", decimals: 18, address: "0x33e4191705c386532ba27cBF171Db86919200B94", kind: "native-wrapped" },
};

// Robinhood Chain MAINNET (chainId 4663) — canonical from docs.robinhood.com/chain/contracts.
const MAINNET: Registry = {
  USDG: { symbol: "USDG", name: "Global Dollar", decimals: 18, address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", kind: "stablecoin" },
  TSLA: { symbol: "TSLA", name: "Tesla", decimals: 18, address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", kind: "stock", feed: null },
  NVDA: { symbol: "NVDA", name: "NVIDIA", decimals: 18, address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", kind: "stock", feed: null },
  SPY: { symbol: "SPY", name: "S&P 500 ETF", decimals: 18, address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", kind: "etf", feed: null },
};

/** Quote/tokenIn asset for USD-denominated intents ("$50 of TSLA") — differs by env. */
export function quoteSymbolFor(env: ChainEnv): string {
  return env === "mainnet" ? "USDG" : "USDC";
}

/** The set of quote/stablecoin symbols to exclude when detecting the target asset from free text. */
export const QUOTE_SYMBOLS = new Set(["USDG", "USDC", "mUSD", "USDE"]);

export function registryFor(env: ChainEnv): Registry {
  return env === "mainnet" ? MAINNET : TESTNET;
}

/** Resolve a user-supplied symbol to a registry entry, or null if unknown (=> reject intent). */
export function resolveAsset(env: ChainEnv, symbol: string): TokenMeta | null {
  return registryFor(env)[symbol.toUpperCase().trim()] ?? null;
}
