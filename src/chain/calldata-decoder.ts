import { decodeFunctionData, decodeAbiParameters, getAddress, size, slice, toFunctionSelector } from "viem";
import type { DecodedSwap } from "./calldata-guard";

/**
 * Uniswap Universal Router calldata decoder (pairs with calldata-guard.ts to complete C2).
 *
 * The guard asserts a security invariant over a normalized `DecodedSwap`; THIS module produces that
 * struct from raw router calldata. Universal Router encoding is canonical (identical across every
 * chain Uniswap deploys to), so the decoder is fully determined and round-trip testable offline.
 *
 * SECURITY MODEL (post-review hardening): `execute` carries an ARBITRARY list of commands. Validating
 * only the first swap is not enough — a second swap, a PERMIT2 command, or a TRANSFER can move funds
 * past a benign-looking leg 0. So we enforce a STRICT command allowlist: exactly one swap command
 * plus zero or more SWEEP commands that each pay out to the signer. Anything else (a second swap,
 * PERMIT2_PERMIT/TRANSFER_FROM, TRANSFER, PAY_PORTION, WRAP/UNWRAP, or an unknown command) is
 * rejected outright. Token approvals are handled as a separate explicit step, not inline here.
 *
 * LIVE-VERIFY GATE: assumes RH's deployed router IS a canonical Universal Router. Before mainnet,
 * capture a real swap tx and confirm this decodes it; a SwapRouter02-only fork needs its own decoder.
 */

// Universal Router Constants.sol sentinels for the recipient field.
const MSG_SENDER = "0x0000000000000000000000000000000000000001" as const; // => the signer (user)
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const; // => the router itself

// Command byte: low 6 bits select the command; the top bit (0x80) is the allow-revert flag.
const COMMAND_TYPE_MASK = 0x3f;
const CMD = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  SWEEP: 0x04,
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
} as const;

const SWAP_COMMANDS: number[] = [
  CMD.V3_SWAP_EXACT_IN,
  CMD.V3_SWAP_EXACT_OUT,
  CMD.V2_SWAP_EXACT_IN,
  CMD.V2_SWAP_EXACT_OUT,
];

const UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;

// (recipient, amountIn|amountOut, amountOutMin|amountInMax, path, payerIsUser)
const V3_SWAP_PARAMS = [
  { type: "address" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "bytes" },
  { type: "bool" },
] as const;
const V2_SWAP_PARAMS = [
  { type: "address" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "address[]" },
  { type: "bool" },
] as const;
// SWEEP(token, recipient, amountMin)
const SWEEP_PARAMS = [{ type: "address" }, { type: "address" }, { type: "uint256" }] as const;

export class CalldataDecodeError extends Error {}

/** First and last 20-byte token address in a V3 packed path (token,fee,token,fee,...). */
function v3PathEnds(path: `0x${string}`): { first: `0x${string}`; last: `0x${string}` } {
  const bytes = size(path);
  if (bytes < 43 || (bytes - 20) % 23 !== 0) {
    throw new CalldataDecodeError(`malformed v3 path (${bytes} bytes)`);
  }
  return { first: getAddress(slice(path, 0, 20)), last: getAddress(slice(path, bytes - 20)) };
}

/** Resolve a Universal Router recipient sentinel against the signer + router address. */
function resolveRecipient(raw: string, user: `0x${string}`, router: `0x${string}`): `0x${string}` {
  const a = getAddress(raw);
  if (a === getAddress(MSG_SENDER)) return user;
  if (a === getAddress(ADDRESS_THIS)) return router;
  return a;
}

interface RawSwap {
  recipientRaw: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountOutMin: bigint; // guaranteed-output floor: amountOutMin (exact-in) or amountOut (exact-out)
  amountInMax: bigint; // input ceiling: amountIn (exact-in, exact) or amountInMax (exact-out)
}

function decodeSwapInput(command: number, input: `0x${string}`): RawSwap {
  if (command === CMD.V3_SWAP_EXACT_IN || command === CMD.V3_SWAP_EXACT_OUT) {
    const [recipient, secondArg, thirdArg, path] = decodeAbiParameters(V3_SWAP_PARAMS, input);
    const ends = v3PathEnds(path as `0x${string}`);
    const exactIn = command === CMD.V3_SWAP_EXACT_IN;
    // Exact-out encodes the path REVERSED (output token first); exact-in is in trade order.
    return {
      recipientRaw: recipient as `0x${string}`,
      tokenIn: exactIn ? ends.first : ends.last,
      tokenOut: exactIn ? ends.last : ends.first,
      // exact-in: (amountIn, amountOutMin). exact-out: (amountOut, amountInMax).
      amountOutMin: exactIn ? (thirdArg as bigint) : (secondArg as bigint),
      amountInMax: exactIn ? (secondArg as bigint) : (thirdArg as bigint),
    };
  }
  if (command === CMD.V2_SWAP_EXACT_IN || command === CMD.V2_SWAP_EXACT_OUT) {
    const [recipient, secondArg, thirdArg, path] = decodeAbiParameters(V2_SWAP_PARAMS, input);
    const addrs = path as readonly `0x${string}`[];
    if (addrs.length < 2) throw new CalldataDecodeError("v2 path needs >= 2 tokens");
    const exactIn = command === CMD.V2_SWAP_EXACT_IN;
    return {
      recipientRaw: recipient as `0x${string}`,
      tokenIn: getAddress(addrs[0]!),
      tokenOut: getAddress(addrs[addrs.length - 1]!),
      amountOutMin: exactIn ? (thirdArg as bigint) : (secondArg as bigint),
      amountInMax: exactIn ? (secondArg as bigint) : (thirdArg as bigint),
    };
  }
  throw new CalldataDecodeError(`command 0x${command.toString(16)} is not a swap`);
}

/**
 * Enforce the strict command allowlist (review finding: only-first-swap validated). Exactly one swap
 * command is permitted; every other command MUST be a SWEEP that pays the signer. Anything else is a
 * fund-movement path we do not model, so we reject rather than let it ride behind a clean leg 0.
 */
function assertSafeCommandSet(
  commandBytes: number[],
  inputs: readonly `0x${string}`[],
  user: `0x${string}`,
  router: `0x${string}`,
): void {
  let swaps = 0;
  for (let i = 0; i < commandBytes.length; i++) {
    const c = commandBytes[i]! & COMMAND_TYPE_MASK;
    if (SWAP_COMMANDS.includes(c)) {
      swaps++;
      continue;
    }
    if (c === CMD.SWEEP) {
      const [, sweepTo] = decodeAbiParameters(SWEEP_PARAMS, inputs[i]!);
      if (resolveRecipient(sweepTo as string, user, router) !== user) {
        throw new CalldataDecodeError(`SWEEP pays a non-signer recipient (${sweepTo})`);
      }
      continue;
    }
    throw new CalldataDecodeError(`disallowed command 0x${c.toString(16)} in swap calldata`);
  }
  if (swaps !== 1) throw new CalldataDecodeError(`expected exactly one swap command, found ${swaps}`);
}

/**
 * Decode + fully validate Universal Router `execute` calldata into the normalized `DecodedSwap`.
 * `user` resolves the MSG_SENDER sentinel; `to` is the router (ADDRESS_THIS resolution target). The
 * command set is validated as a whole, then the single swap is decoded; if its output is parked in
 * the router (ADDRESS_THIS), the matching SWEEP defines the real recipient + floor.
 */
export function decodeUniversalRouterSwap(
  calldata: `0x${string}`,
  to: `0x${string}`,
  user: `0x${string}`,
): DecodedSwap {
  let commands: `0x${string}`;
  let inputs: readonly `0x${string}`[];
  try {
    const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: calldata });
    commands = decoded.args[0] as `0x${string}`;
    inputs = decoded.args[1] as readonly `0x${string}`[];
  } catch (e) {
    throw new CalldataDecodeError(`not Universal Router execute calldata: ${(e as Error).message}`);
  }

  const commandBytes: number[] = [];
  const hex = commands.slice(2);
  for (let i = 0; i < hex.length; i += 2) commandBytes.push(parseInt(hex.slice(i, i + 2), 16));
  if (commandBytes.length !== inputs.length) {
    throw new CalldataDecodeError("commands/inputs length mismatch");
  }

  const router = getAddress(to);
  assertSafeCommandSet(commandBytes, inputs, user, router);

  const swapIndex = commandBytes.findIndex((b) => SWAP_COMMANDS.includes(b & COMMAND_TYPE_MASK));
  const swap = decodeSwapInput(commandBytes[swapIndex]! & COMMAND_TYPE_MASK, inputs[swapIndex]!);
  let recipient = resolveRecipient(swap.recipientRaw, user, router);
  let amountOutMin = swap.amountOutMin;

  // Swap output parked in the router: a SWEEP of tokenOut defines who actually gets it + the floor.
  if (recipient === router) {
    for (let i = 0; i < commandBytes.length; i++) {
      if ((commandBytes[i]! & COMMAND_TYPE_MASK) !== CMD.SWEEP) continue;
      const [token, sweepTo, amountMin] = decodeAbiParameters(SWEEP_PARAMS, inputs[i]!);
      if (getAddress(token as string) !== swap.tokenOut) continue;
      recipient = resolveRecipient(sweepTo as string, user, router);
      amountOutMin = amountMin as bigint; // what the user is guaranteed to receive from the sweep
      break;
    }
  }

  return {
    to: router,
    recipient,
    tokenIn: swap.tokenIn,
    tokenOut: swap.tokenOut,
    amountOutMin,
    amountInMax: swap.amountInMax,
  };
}

/**
 * NeighborSwapRouter `exactInputSingle` decoder.
 *
 * Robinhood Chain testnet exposes no Universal Router bound to the funded factory, so Neighbor
 * deploys its own minimal router whose only entrypoint is `exactInputSingle(ExactInputSingleParams)`
 * (contracts/src/NeighborSwapRouter.sol). This shape is far simpler than the Universal Router command
 * list: one exact-input swap, output paid straight to `recipient`, no inline approvals or sweeps — so
 * the security invariants map directly. Because it is exact-INPUT, the input is exact: amountInMax ==
 * amountIn (there is no input-side sandwich room), and amountOutMinimum is the output floor the guard
 * checks against the confirmed minOut.
 */
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

const NEIGHBOR_EXACT_INPUT_SINGLE_SELECTOR = toFunctionSelector(
  "exactInputSingle((address,address,uint24,address,uint256,uint256))",
);

export function decodeNeighborRouterSwap(
  calldata: `0x${string}`,
  to: `0x${string}`,
  _user: `0x${string}`,
): DecodedSwap {
  let params;
  try {
    const decoded = decodeFunctionData({ abi: NEIGHBOR_ROUTER_ABI, data: calldata });
    params = decoded.args[0] as {
      tokenIn: `0x${string}`;
      tokenOut: `0x${string}`;
      fee: number;
      recipient: `0x${string}`;
      amountIn: bigint;
      amountOutMinimum: bigint;
    };
  } catch (e) {
    throw new CalldataDecodeError(`not NeighborSwapRouter exactInputSingle calldata: ${(e as Error).message}`);
  }

  return {
    to: getAddress(to),
    recipient: getAddress(params.recipient), // router pays output directly to this address (must be the user)
    tokenIn: getAddress(params.tokenIn),
    tokenOut: getAddress(params.tokenOut),
    amountOutMin: params.amountOutMinimum,
    amountInMax: params.amountIn, // exact input: the input side is fixed, no sandwich room
  };
}

/**
 * Dispatch to the correct decoder by function selector, then hand the normalized `DecodedSwap` to the
 * shared guard. Neighbor's `exactInputSingle` and Uniswap's `execute` are the two shapes a signed swap
 * can carry; anything else is undecodable and rejected upstream (fail-closed).
 */
export function decodeSwapCalldata(
  calldata: `0x${string}`,
  to: `0x${string}`,
  user: `0x${string}`,
): DecodedSwap {
  if (size(calldata) < 4) throw new CalldataDecodeError("calldata too short for a selector");
  const selector = slice(calldata, 0, 4);
  if (selector === NEIGHBOR_EXACT_INPUT_SINGLE_SELECTOR) {
    return decodeNeighborRouterSwap(calldata, to, user);
  }
  return decodeUniversalRouterSwap(calldata, to, user);
}
