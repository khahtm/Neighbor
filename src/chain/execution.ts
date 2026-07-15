import { encodeFunctionData } from "viem";
import type { ChainEnv } from "./chains";
import { publicClient } from "./client";
import { dexConfig } from "./dex-config";

/**
 * Live-chain execution seams (red-team C4).
 *
 * `buildSwapCalldata` encodes a swap against the env's deployed router; the read/write RPC helpers
 * (nonce, broadcast, confirmations) go through the shared viem client. Each still fails CLOSED when
 * its env prerequisite is absent — no router configured, or a null pool fee — so mainnet (router not
 * yet set) throws a precise ExecutionSeamError rather than encoding calldata to a zero address.
 *
 * Non-custodial contract (unchanged): we never sign. `buildSwapCalldata` produces the exact bytes the
 * user's wallet signs; `broadcastRawTx` only relays already-signed bytes. The calldata built here is
 * re-decoded + guarded (calldata-guard C2) before the user signs and again on the signed tx.
 */

export class ExecutionSeamError extends Error {}

/** A minimal signable transaction request (the shape a wallet signs). */
export interface SwapTxRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

export interface SwapCalldataParams {
  env: ChainEnv;
  userAddress: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOutMin: bigint;
  fee: number; // pool fee tier from the quote — execute must hit the same pool the quote priced
  deadline: bigint; // kept for interface stability; NeighborSwapRouter has no deadline arg (see below)
}

// NeighborSwapRouter.exactInputSingle(ExactInputSingleParams) — the only entrypoint of our testnet
// router (contracts/src/NeighborSwapRouter.sol). Output is paid straight to `recipient`.
const NEIGHBOR_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/**
 * Encode a swap into a signable tx targeting the env's router. The output recipient is the user's own
 * wallet (the guard asserts recipient == user), amountOutMinimum is the confirmed slippage floor, and
 * the input is exact (`amountIn`). value = 0 — the input is an ERC-20 the router pulls via
 * transferFrom, so the wallet must have approved the router for `amountIn` first (a separate signed
 * approval tx). Throws (fail-closed) when the env has no router configured (mainnet until populated).
 */
export function buildSwapCalldata(params: SwapCalldataParams): SwapTxRequest {
  const cfg = dexConfig(params.env);
  if (!cfg.router) {
    throw new ExecutionSeamError(`buildSwapCalldata blocked: no router configured for ${params.env}`);
  }
  const data = encodeFunctionData({
    abi: NEIGHBOR_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        recipient: params.userAddress,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMin,
      },
    ],
  });
  return { to: cfg.router, data, value: 0n };
}

/** Read the wallet's next nonce (pending) — the idempotency anchor persisted before broadcast (C4). */
export function reserveNonce(_env: ChainEnv, userAddress: `0x${string}`): Promise<number> {
  return publicClient.getTransactionCount({ address: userAddress, blockTag: "pending" });
}

/** Relay a user-signed raw transaction (non-custodial: the user signed, we only submit). */
export function broadcastRawTx(_env: ChainEnv, signedRawTx: `0x${string}`): Promise<`0x${string}`> {
  return publicClient.sendRawTransaction({ serializedTransaction: signedRawTx });
}

/** Confirmations for a tx hash (0 if not yet mined / dropped). Fed to tx-state.isFinal / isReorged. */
export async function getConfirmations(_env: ChainEnv, hash: `0x${string}`): Promise<number> {
  const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return 0; // not mined yet, or dropped
  const head = await publicClient.getBlockNumber();
  return head >= receipt.blockNumber ? Number(head - receipt.blockNumber) + 1 : 0;
}

/**
 * Pool reference prices for the oracle sanity check (C3), both in the SAME fixed-point scale as the
 * Chainlink NAV answer so the deviation comparison is meaningful. `spot` is the current pool price
 * used as `quotedPrice`; `twap` is an INDEPENDENT time-averaged price used as the off-hours reference
 * — deliberately NOT the same number, so the check is not circular (review finding). BLOCKED until
 * a live pool read + feed-decimal alignment land.
 */
export interface PoolReferencePrices {
  spot: bigint;
  twap: bigint;
}
export function getPoolReferencePrices(
  _env: ChainEnv,
  _tokenIn: `0x${string}`,
  _tokenOut: `0x${string}`,
): Promise<PoolReferencePrices> {
  throw new ExecutionSeamError(
    "getPoolReferencePrices blocked: independent TWAP read + feed-decimal alignment not implemented",
  );
}
