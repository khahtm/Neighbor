import { createPublicClient, http, type PublicClient } from "viem";
import { activeChain } from "./chains";

/** Read-only client for the active Robinhood Chain (testnet/mainnet per CHAIN_ENV). */
export const publicClient: PublicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
});

/** ERC-20 balanceOf helper (portfolio reads are done directly on-chain — no indexer in MVP). */
export async function erc20BalanceOf(
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [owner],
  });
}

/**
 * ERC-20 allowance helper. The swap router pulls `tokenIn` via transferFrom, so the client checks
 * this before signing a swap and prompts an `approve` only when the current allowance is short.
 */
export async function erc20Allowance(
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: [
      {
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "allowance",
    args: [owner, spender],
  });
}
