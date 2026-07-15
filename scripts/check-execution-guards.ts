/**
 * Offline self-check for the Phase 4 execution guards (red-team C2/C3/C4/C12 defenses).
 * Exercises the deterministic swap-safety, slippage, oracle-policy, and tx-state logic with
 * fabricated inputs — no live RPC, router, or oracle needed. Run: `npm run check:exec`.
 */
import assert from "node:assert";
import { minOut, maxIn, assertSlippageWithinCap, SLIPPAGE_MAX_BPS, RoutingError } from "../src/chain/routing";
import { assertSwapSafe, type DecodedSwap, type SwapExpectation } from "../src/chain/calldata-guard";
import {
  checkOracleSanity,
  chooseReference,
  deviationBps,
  isUsEquityMarketOpen,
} from "../src/chain/oracle-guard";
import type { OracleReading } from "../src/chain/oracle";
import { canTransition, isFinal, isReorged, shouldUnsettle, shouldReplaceByNonce } from "../src/chain/tx-state";
import {
  decodeUniversalRouterSwap,
  decodeNeighborRouterSwap,
  decodeSwapCalldata,
  CalldataDecodeError,
} from "../src/chain/calldata-decoder";
import { guardSignedSwap } from "../src/chain/signed-tx-guard";
import { sizeOrder } from "../src/chain/order-sizing";
import { needsPermit2Approval, buildPermitSingleTypedData, PERMIT2_ADDRESS } from "../src/chain/permit2";
import { ratifyIntent } from "../src/agent/ratify-intent";
import type { Intent } from "../src/agent/intent-schema";
import { encodeFunctionData, encodeAbiParameters, concat, numberToHex, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = "testnet" as const;

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// Fake but well-formed addresses. The happy path needs `to` allowlisted; tests inject their own
// allow predicate (below) so the invariant is exercised independently of the real deployed address.
const USER = "0x1111111111111111111111111111111111111111" as const;
const ATTACKER = "0x2222222222222222222222222222222222222222" as const;
const ROUTER = "0x3333333333333333333333333333333333333333" as const;
const USDG = "0x4444444444444444444444444444444444444444" as const;
const TSLA = "0x5555555555555555555555555555555555555555" as const;

// Inject a test predicate that treats ROUTER as allowed — the DI seam assertSwapSafe exposes so the
// guard invariant is tested with a fabricated address, decoupled from the real deployed router.
const allowRouter = (_e: string, to: string) => to.toLowerCase() === ROUTER.toLowerCase();

const expected: SwapExpectation = { userAddress: USER, tokenIn: USDG, tokenOut: TSLA, minOut: 950n, maxIn: 1000n };
function swap(over: Partial<DecodedSwap> = {}): DecodedSwap {
  return { to: ROUTER, recipient: USER, tokenIn: USDG, tokenOut: TSLA, amountOutMin: 1000n, amountInMax: 1000n, ...over };
}

// ---- routing / slippage (C12) ----
check("minOut floors against the user at 1%", () => {
  assert.equal(minOut(10_000n, 100), 9_900n);
});
check("minOut at 3% cap ok, above cap throws", () => {
  assert.equal(minOut(10_000n, SLIPPAGE_MAX_BPS), 9_700n);
  assert.throws(() => assertSlippageWithinCap(SLIPPAGE_MAX_BPS + 1), RoutingError);
});

// ---- calldata guard (C2) ----
check("clean swap passes", () => {
  assert.equal(assertSwapSafe(env, swap(), expected, allowRouter).ok, true);
});
check("recipient != user is blocked (theft)", () => {
  const r = assertSwapSafe(env, swap({ recipient: ATTACKER }), expected, allowRouter);
  assert.equal(r.ok, false);
});
check("router not in allowlist is blocked", () => {
  const r = assertSwapSafe(env, swap({ to: ATTACKER }), expected, allowRouter);
  assert.equal(r.ok, false);
});
check("tokenOut mismatch is blocked", () => {
  const r = assertSwapSafe(env, swap({ tokenOut: ATTACKER }), expected, allowRouter);
  assert.equal(r.ok, false);
});
check("amountOutMin below confirmed floor is blocked (output sandwich room)", () => {
  const r = assertSwapSafe(env, swap({ amountOutMin: 949n }), expected, allowRouter);
  assert.equal(r.ok, false);
});
check("amountInMax above confirmed ceiling is blocked (input sandwich room, C12)", () => {
  const r = assertSwapSafe(env, swap({ amountInMax: 1001n }), expected, allowRouter); // expected.maxIn = 1000
  assert.equal(r.ok, false);
});

// ---- oracle policy (C3) ----
// A Wednesday 15:00 UTC (market open) and a Sunday (closed).
const MARKET_OPEN = Date.UTC(2026, 6, 15, 15, 0, 0) / 1000; // Wed
const MARKET_CLOSED = Date.UTC(2026, 6, 12, 15, 0, 0) / 1000; // Sun
function reading(over: Partial<OracleReading> = {}): OracleReading {
  return { answer: 1000n, decimals: 8, updatedAt: 0n, roundId: 1n, isStale: false, ...over };
}
check("market-hours detector: Wed open, Sun closed", () => {
  assert.equal(isUsEquityMarketOpen(MARKET_OPEN), true);
  assert.equal(isUsEquityMarketOpen(MARKET_CLOSED), false);
});
check("deviationBps computes symmetric percentage", () => {
  assert.equal(deviationBps(1020n, 1000n), 200);
  assert.equal(deviationBps(980n, 1000n), 200);
});
check("fresh + market-open + 3% deviation blocks", () => {
  const r = checkOracleSanity(1030n, reading(), 1000n, MARKET_OPEN);
  assert.equal(r.ok, false);
  assert.equal(r.source, "nav");
});
check("fresh + market-open + within cap passes on NAV", () => {
  const r = checkOracleSanity(1010n, reading(), 1000n, MARKET_OPEN);
  assert.equal(r.ok, true);
  assert.equal(r.source, "nav");
});
check("off-hours does NOT NAV-block (uses TWAP, no false reject)", () => {
  const r = checkOracleSanity(1030n, reading(), 1000n, MARKET_CLOSED);
  assert.equal(r.ok, true);
  assert.equal(r.source, "pool-twap");
});
check("stale feed during market hours falls back to TWAP", () => {
  const d = chooseReference(reading({ isStale: true }), 1000n, MARKET_OPEN);
  assert.equal(d.navAuthoritative, false);
  assert.equal(d.source, "pool-twap");
});

// ---- tx state machine + finality (C4) ----
check("legal + illegal transitions", () => {
  assert.equal(canTransition("built", "swap_pending"), true);
  assert.equal(canTransition("swap_pending", "confirmed"), true);
  assert.equal(canTransition("confirmed", "swap_pending"), false); // terminal
  assert.equal(canTransition("built", "confirmed"), false); // cannot skip pending
});
check("finality depth gates confirmed", () => {
  assert.equal(isFinal(11, 12), false);
  assert.equal(isFinal(12, 12), true);
});
check("reorg drops a soft-confirmed tx", () => {
  assert.equal(isReorged(3, 0), true);
  assert.equal(isReorged(0, 0), false);
});
check("stuck pending is replaced by nonce; terminal is not", () => {
  assert.equal(shouldReplaceByNonce("swap_pending", 120, 90), true);
  assert.equal(shouldReplaceByNonce("swap_pending", 30, 90), false);
  assert.equal(shouldReplaceByNonce("confirmed", 999, 90), false);
});

// ---- Universal Router calldata decoder (C2 completion) ----
// Build known-good router calldata exactly as Universal Router encodes it, then decode + assert.
// This proves the decoder inverts the canonical encoding offline (no live router needed).
const UR_ABI = [
  { type: "function", name: "execute", stateMutability: "payable", inputs: [
    { name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }, { name: "deadline", type: "uint256" }], outputs: [] },
] as const;
const V3_PARAMS = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }] as const;
const V2_PARAMS = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "bool" }] as const;
const SWEEP_PARAMS = [{ type: "address" }, { type: "address" }, { type: "uint256" }] as const;
const MSG_SENDER = "0x0000000000000000000000000000000000000001" as const;
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;

function v3Path(a: Hex, fee: number, b: Hex): Hex {
  return concat([a, numberToHex(fee, { size: 3 }), b]);
}
function urCalldata(commands: Hex, inputs: Hex[]): Hex {
  return encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: [commands, inputs, 0n] });
}
const lc = (s: string) => s.toLowerCase();

check("decodes V3 exact-in, resolves MSG_SENDER recipient to the signer", () => {
  const input = encodeAbiParameters(V3_PARAMS, [MSG_SENDER, 1000n, 950n, v3Path(USDG, 3000, TSLA), true]);
  const d = decodeUniversalRouterSwap(urCalldata("0x00", [input]), ROUTER, USER);
  assert.equal(lc(d.recipient), lc(USER));
  assert.equal(lc(d.tokenIn), lc(USDG));
  assert.equal(lc(d.tokenOut), lc(TSLA));
  assert.equal(d.amountOutMin, 950n);
});
check("decoded real calldata passes the C2 guard end-to-end", () => {
  const input = encodeAbiParameters(V3_PARAMS, [MSG_SENDER, 1000n, 950n, v3Path(USDG, 3000, TSLA), true]);
  const d = decodeUniversalRouterSwap(urCalldata("0x00", [input]), ROUTER, USER);
  const r = assertSwapSafe(env, d, { userAddress: USER, tokenIn: USDG, tokenOut: TSLA, minOut: 950n, maxIn: 1000n }, allowRouter);
  assert.equal(r.ok, true);
});
check("V3 exact-out reverses the path, floors at amountOut, and captures amountInMax", () => {
  // exact-out path is encoded reversed: output token first. (amountOut=500, amountInMax=2000)
  const input = encodeAbiParameters(V3_PARAMS, [MSG_SENDER, 500n, 2000n, v3Path(TSLA, 3000, USDG), true]);
  const d = decodeUniversalRouterSwap(urCalldata("0x01", [input]), ROUTER, USER);
  assert.equal(lc(d.tokenIn), lc(USDG));
  assert.equal(lc(d.tokenOut), lc(TSLA));
  assert.equal(d.amountOutMin, 500n); // exact output IS the floor
  assert.equal(d.amountInMax, 2000n); // input ceiling is guarded too (finding 3)
});
check("decodes V2 exact-in from an address[] path", () => {
  const input = encodeAbiParameters(V2_PARAMS, [MSG_SENDER, 1000n, 900n, [USDG, TSLA], true]);
  const d = decodeUniversalRouterSwap(urCalldata("0x08", [input]), ROUTER, USER);
  assert.equal(lc(d.tokenIn), lc(USDG));
  assert.equal(lc(d.tokenOut), lc(TSLA));
  assert.equal(d.amountOutMin, 900n);
});
check("swap-to-router + SWEEP resolves the true recipient and floor", () => {
  const swap = encodeAbiParameters(V3_PARAMS, [ADDRESS_THIS, 1000n, 0n, v3Path(USDG, 3000, TSLA), true]);
  const sweep = encodeAbiParameters(SWEEP_PARAMS, [TSLA, MSG_SENDER, 940n]);
  const d = decodeUniversalRouterSwap(urCalldata("0x0004", [swap, sweep]), ROUTER, USER);
  assert.equal(lc(d.recipient), lc(USER)); // SWEEP sends to MSG_SENDER = the signer
  assert.equal(d.amountOutMin, 940n); // the sweep min is what the user is guaranteed
});
check("swap parked in router with NO sweep leaves recipient = router (guard will reject)", () => {
  const swap = encodeAbiParameters(V3_PARAMS, [ADDRESS_THIS, 1000n, 950n, v3Path(USDG, 3000, TSLA), true]);
  const d = decodeUniversalRouterSwap(urCalldata("0x00", [swap]), ROUTER, USER);
  assert.equal(lc(d.recipient), lc(ROUTER));
  const r = assertSwapSafe(env, d, { userAddress: USER, tokenIn: USDG, tokenOut: TSLA, minOut: 950n, maxIn: 1000n }, allowRouter);
  assert.equal(r.ok, false); // recipient != user
});
check("non-router / non-swap calldata is rejected", () => {
  assert.throws(() => decodeUniversalRouterSwap("0xdeadbeef", ROUTER, USER), CalldataDecodeError);
});
// Adversarial command sets (review finding 2: only-first-swap validated). Anything beyond a single
// swap + signer-paying SWEEPs must be rejected outright, not ride behind a clean leg 0.
check("a SECOND swap command is rejected (drain-behind-clean-leg)", () => {
  const leg = encodeAbiParameters(V3_PARAMS, [MSG_SENDER, 1000n, 950n, v3Path(USDG, 3000, TSLA), true]);
  const drain = encodeAbiParameters(V3_PARAMS, [ATTACKER, 1000n, 0n, v3Path(USDG, 3000, TSLA), true]);
  assert.throws(() => decodeUniversalRouterSwap(urCalldata("0x0000", [leg, drain]), ROUTER, USER), CalldataDecodeError);
});
check("a disallowed command (TRANSFER 0x05) alongside a swap is rejected", () => {
  const leg = encodeAbiParameters(V3_PARAMS, [MSG_SENDER, 1000n, 950n, v3Path(USDG, 3000, TSLA), true]);
  assert.throws(() => decodeUniversalRouterSwap(urCalldata("0x0005", [leg, "0x"]), ROUTER, USER), CalldataDecodeError);
});
check("a SWEEP paying a non-signer is rejected", () => {
  const leg = encodeAbiParameters(V3_PARAMS, [ADDRESS_THIS, 1000n, 950n, v3Path(USDG, 3000, TSLA), true]);
  const steal = encodeAbiParameters(SWEEP_PARAMS, [TSLA, ATTACKER, 0n]);
  assert.throws(() => decodeUniversalRouterSwap(urCalldata("0x0004", [leg, steal]), ROUTER, USER), CalldataDecodeError);
});

// ---- NeighborSwapRouter exactInputSingle decoder (testnet router) ----
// Our own router (no Universal Router on RH testnet). exactInputSingle pays output straight to
// `recipient`; exact input means amountInMax == amountIn (no input-side sandwich room).
const NEIGHBOR_ABI = [
  { type: "function", name: "exactInputSingle", stateMutability: "nonpayable", inputs: [
    { name: "params", type: "tuple", components: [
      { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
      { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }],
    }], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;
function neighborCalldata(p: { tokenIn: Hex; tokenOut: Hex; fee: number; recipient: Hex; amountIn: bigint; amountOutMinimum: bigint }): Hex {
  return encodeFunctionData({ abi: NEIGHBOR_ABI, functionName: "exactInputSingle", args: [p] });
}

check("decodes exactInputSingle: recipient, tokens, floor, and exact input", () => {
  const data = neighborCalldata({ tokenIn: USDG, tokenOut: TSLA, fee: 3000, recipient: USER, amountIn: 1000n, amountOutMinimum: 950n });
  const d = decodeNeighborRouterSwap(data, ROUTER, USER);
  assert.equal(lc(d.recipient), lc(USER));
  assert.equal(lc(d.tokenIn), lc(USDG));
  assert.equal(lc(d.tokenOut), lc(TSLA));
  assert.equal(d.amountOutMin, 950n);
  assert.equal(d.amountInMax, 1000n); // exact-in: input side is fixed
});
check("decoded exactInputSingle passes the C2 guard end-to-end", () => {
  const data = neighborCalldata({ tokenIn: USDG, tokenOut: TSLA, fee: 3000, recipient: USER, amountIn: 1000n, amountOutMinimum: 950n });
  const d = decodeNeighborRouterSwap(data, ROUTER, USER);
  const r = assertSwapSafe(env, d, { userAddress: USER, tokenIn: USDG, tokenOut: TSLA, minOut: 950n, maxIn: 1000n }, allowRouter);
  assert.equal(r.ok, true);
});
check("exactInputSingle paying a non-signer recipient is caught by the guard", () => {
  const data = neighborCalldata({ tokenIn: USDG, tokenOut: TSLA, fee: 3000, recipient: ATTACKER, amountIn: 1000n, amountOutMinimum: 950n });
  const d = decodeNeighborRouterSwap(data, ROUTER, USER);
  const r = assertSwapSafe(env, d, { userAddress: USER, tokenIn: USDG, tokenOut: TSLA, minOut: 950n, maxIn: 1000n }, allowRouter);
  assert.equal(r.ok, false); // recipient != user
});
check("dispatcher routes exactInputSingle to the Neighbor decoder", () => {
  const data = neighborCalldata({ tokenIn: USDG, tokenOut: TSLA, fee: 3000, recipient: USER, amountIn: 1000n, amountOutMinimum: 950n });
  const d = decodeSwapCalldata(data, ROUTER, USER);
  assert.equal(lc(d.tokenOut), lc(TSLA));
  assert.equal(d.amountInMax, 1000n);
});
check("dispatcher routes Universal Router execute to the UR decoder", () => {
  const input = encodeAbiParameters(V3_PARAMS, [MSG_SENDER, 1000n, 950n, v3Path(USDG, 3000, TSLA), true]);
  const d = decodeSwapCalldata(urCalldata("0x00", [input]), ROUTER, USER);
  assert.equal(lc(d.recipient), lc(USER));
  assert.equal(d.amountOutMin, 950n);
});

// ---- order sizing ----
function intent(over: Partial<Intent>): Intent {
  return { action: "buy", asset: "TSLA", amount: "50", unit: "USD", ...over };
}
check("buy $X sizes an exact-input of X quote-asset units", () => {
  const s = sizeOrder(env, intent({ action: "buy", unit: "USD", amount: "50" }));
  assert.equal(s.kind, "exact-in");
  if (s.kind === "exact-in") {
    assert.equal(s.tokenIn.symbol, "USDC"); // testnet quote asset (USDG is mainnet)
    assert.equal(s.tokenOut.symbol, "TSLA");
    assert.equal(s.amountIn, parseUnits("50", 18));
  }
});
check("sell N tokens sizes an exact-input of N asset units", () => {
  const s = sizeOrder(env, intent({ action: "sell", unit: "token", amount: "10" }));
  assert.equal(s.kind, "exact-in");
  if (s.kind === "exact-in") {
    assert.equal(s.tokenIn.symbol, "TSLA");
    assert.equal(s.amountIn, parseUnits("10", 18));
  }
});
check("buy N tokens is exact-output (input sized from the quote)", () => {
  assert.equal(sizeOrder(env, intent({ action: "buy", unit: "token", amount: "3" })).kind, "needs-quote-exact-out");
});
check("percent order needs a live balance read", () => {
  const s = sizeOrder(env, intent({ action: "sell", unit: "percent", amount: "50" }));
  assert.equal(s.kind, "needs-balance");
  if (s.kind === "needs-balance") assert.equal(s.percent, 50);
});

// ---- Permit2 approve path (C13) ----
check("needsPermit2Approval only when allowance is short", () => {
  assert.equal(needsPermit2Approval(0n, 1000n), true);
  assert.equal(needsPermit2Approval(1000n, 1000n), false);
  assert.equal(needsPermit2Approval(2000n, 1000n), false);
});
check("PermitSingle typed data binds token/spender/amount to the Permit2 domain", () => {
  const td = buildPermitSingleTypedData(46630, {
    token: USDG, spender: ROUTER, amount: 1000n, expiration: 1_000_000, nonce: 0, sigDeadline: 2_000_000n,
  });
  assert.equal(td.domain.verifyingContract, PERMIT2_ADDRESS);
  assert.equal(td.domain.chainId, 46630);
  assert.equal(td.message.spender, ROUTER);
  assert.equal(td.message.details.amount, 1000n);
});

// ---- ratify-at-execution (C11): trade direction must be independently readable ----
check("ratify rejects a trade with no explicit direction (injection could flip buy/sell)", () => {
  const r = ratifyIntent("TSLA 10 tokens", { action: "buy", asset: "TSLA", amount: "10", unit: "token" }, env);
  assert.equal(r.ok, false);
});
check("ratify accepts a well-formed directional intent", () => {
  const r = ratifyIntent("buy 10 TSLA tokens", { action: "buy", asset: "TSLA", amount: "10", unit: "token" }, env);
  assert.equal(r.ok, true);
});

// ---- partial reorg (C4): a drop below finality, not only to zero, must un-settle ----
check("partial reorg below finality un-settles a confirmed tx", () => {
  assert.equal(shouldUnsettle(true, 3, 12), true); // was final, now 3 < 12 => un-settle
  assert.equal(shouldUnsettle(true, 12, 12), false); // still final
  assert.equal(shouldUnsettle(false, 0, 12), false); // never final
  assert.equal(isReorged(3, 0), true); // full drop still detected
});

// ---- signed-tx guard (C2/C4): guard the EXACT tx that will be broadcast ----
// Well-known Hardhat test key #0 — public, for signing fabricated txs offline only.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const acct = privateKeyToAccount(TEST_KEY);
const CHAIN_ID = 46630; // RH testnet
const gasFields = { gas: 200_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, value: 0n } as const;
const cleanData = urCalldata("0x00", [encodeAbiParameters(V3_PARAMS, [MSG_SENDER, 1000n, 950n, v3Path(USDG, 3000, TSLA), true])]);
const evilData = urCalldata("0x00", [encodeAbiParameters(V3_PARAMS, [ATTACKER, 1000n, 950n, v3Path(USDG, 3000, TSLA), true])]);
const exp: SwapExpectation = { userAddress: USER, tokenIn: USDG, tokenOut: TSLA, minOut: 950n, maxIn: 1000n };

await (async () => {
  const signedClean = await acct.signTransaction({ to: ROUTER, data: cleanData, nonce: 7, chainId: CHAIN_ID, ...gasFields });
  const signedEvil = await acct.signTransaction({ to: ROUTER, data: evilData, nonce: 8, chainId: CHAIN_ID, ...gasFields });
  const signedWrongChain = await acct.signTransaction({ to: ROUTER, data: cleanData, nonce: 9, chainId: 1, ...gasFields });

  check("guardSignedSwap passes a clean signed tx and extracts nonce + hash", () => {
    const g = guardSignedSwap(env, signedClean, exp, CHAIN_ID, allowRouter);
    assert.equal(g.ok, true);
    if (g.ok) {
      assert.equal(g.nonce, 7);
      assert.match(g.hash, /^0x[0-9a-f]{64}$/);
    }
  });
  check("guardSignedSwap rejects a signed tx whose calldata redirects output (409)", () => {
    const g = guardSignedSwap(env, signedEvil, exp, CHAIN_ID, allowRouter);
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.status, 409);
  });
  check("guardSignedSwap rejects a tx signed for the wrong chain (replay)", () => {
    const g = guardSignedSwap(env, signedWrongChain, exp, CHAIN_ID, allowRouter);
    assert.equal(g.ok, false);
  });
})();

console.log(`\n[check-execution-guards] ${passed} checks passed`);
