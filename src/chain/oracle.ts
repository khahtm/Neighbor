import { publicClient } from "./client";

/**
 * Chainlink price oracle reads for Robinhood Chain (verified: push-based Price Feeds via
 * AggregatorV3Interface.latestRoundData()). Stock feeds update 24/5 (market hours) while the
 * pool trades 24/7 — so staleness handling is MANDATORY (plan red-team C3): off-hours the NAV
 * feed is stale and must NOT be used to block-by-divergence; fall back to a pool TWAP reference.
 *
 * Feed addresses + per-feed heartbeat are the source-of-truth on Chainlink's Robinhood price-feeds
 * page — do not hardcode here; load into the registry after reading them from that page.
 */

const AGGREGATOR_V3_ABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

export interface OracleReading {
  answer: bigint;
  decimals: number;
  updatedAt: bigint;
  roundId: bigint;
  /** stale if now - updatedAt exceeds the feed heartbeat (off-hours 24/5 feeds go stale nightly/weekends). */
  isStale: boolean;
}

/**
 * Read a Chainlink feed with staleness classification.
 * @param feed aggregator address
 * @param heartbeatSeconds per-feed heartbeat (from Chainlink RH feeds page)
 * @param nowSeconds unix seconds (inject for testability)
 */
export async function readFeed(
  feed: `0x${string}`,
  heartbeatSeconds: number,
  nowSeconds: number,
): Promise<OracleReading> {
  const [roundId, answer, , updatedAt] = await publicClient.readContract({
    address: feed,
    abi: AGGREGATOR_V3_ABI,
    functionName: "latestRoundData",
  });
  const decimals = await publicClient.readContract({
    address: feed,
    abi: AGGREGATOR_V3_ABI,
    functionName: "decimals",
  });
  const isStale = nowSeconds - Number(updatedAt) > heartbeatSeconds;
  return { answer, decimals, updatedAt, roundId, isStale };
}
