/**
 * Chain smoke test — verifies RPC connectivity to the active Robinhood Chain and reads a block.
 * Run: `npm run chain:smoke` (uses CHAIN_ENV, ALCHEMY_API_KEY or public RPC).
 * This is the Phase 1 "read a block on testnet" success criterion.
 */
import { publicClient } from "../src/chain/client";
import { activeChain, CHAIN_ENV } from "../src/chain/chains";

async function main() {
  console.log(`[smoke] chain=${activeChain.name} id=${activeChain.id} env=${CHAIN_ENV}`);
  const block = await publicClient.getBlockNumber();
  console.log(`[smoke] latest block: ${block}`);
  const chainId = await publicClient.getChainId();
  if (chainId !== activeChain.id) {
    throw new Error(`chainId mismatch: RPC=${chainId} expected=${activeChain.id}`);
  }
  console.log(`[smoke] OK — RPC reachable, chainId matches`);
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e);
  process.exit(1);
});
