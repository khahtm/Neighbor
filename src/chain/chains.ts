import { defineChain } from "viem";

/**
 * Robinhood Chain network definitions (verified 2026-07-13 from docs.robinhood.com/chain/connecting).
 * Arbitrum Orbit L2, ETH gas, single Robinhood sequencer (~100ms soft confirmation).
 * IMPORTANT: soft confirmation != finality. Execution paths must wait a finality depth
 * before treating a tx as settled (see plan red-team C4/C15).
 */

const alchemyKey = process.env.ALCHEMY_API_KEY ?? "";

function rpc(explicit: string | undefined, alchemyHost: string, publicUrl: string): string {
  if (explicit) return explicit;
  if (alchemyKey) return `https://${alchemyHost}.g.alchemy.com/v2/${alchemyKey}`;
  return publicUrl; // public RPC is rate-limited; fine for reads/spikes
}

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [rpc(process.env.RPC_URL_MAINNET, "robinhood-mainnet", "https://rpc.mainnet.chain.robinhood.com")],
      webSocket: ["wss://feed.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  testnet: false,
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [rpc(process.env.RPC_URL_TESTNET, "robinhood-testnet", "https://rpc.testnet.chain.robinhood.com")],
      webSocket: ["wss://feed.testnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export type ChainEnv = "testnet" | "mainnet";

// NEXT_PUBLIC_CHAIN_ENV is readable in the browser bundle; CHAIN_ENV is server-only.
export const CHAIN_ENV: ChainEnv =
  (process.env.NEXT_PUBLIC_CHAIN_ENV ?? process.env.CHAIN_ENV) === "mainnet"
    ? "mainnet"
    : "testnet";

/** Active chain for this process, selected by CHAIN_ENV (defaults to testnet). */
export const activeChain =
  CHAIN_ENV === "mainnet" ? robinhoodMainnet : robinhoodTestnet;

export const FAUCET_URL_TESTNET = "https://faucet.testnet.chain.robinhood.com";
