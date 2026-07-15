/**
 * Live testnet swap smoke test (phase B2 acceptance): exercise the REAL money-path modules end-to-end
 * against the funded RH-testnet pool — getQuote -> minOut -> buildSwapCalldata -> calldata guard ->
 * sign -> guardSignedSwap -> broadcastRawTx -> confirm. Sells a small amount of TSLA for USDC using
 * the DEPLOYER_PRIVATE_KEY wallet as the stand-in signer.
 *
 * NOT part of the offline check suite (it needs RPC + a funded key). Run manually:
 *   npx tsx scripts/swap-smoke.ts
 */
import "dotenv/config";
import { createWalletClient, http, parseUnits, formatUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodTestnet } from "../src/chain/chains";
import { publicClient } from "../src/chain/client";
import { getQuote, minOut, SLIPPAGE_DEFAULT_BPS } from "../src/chain/routing";
import { buildSwapCalldata, broadcastRawTx } from "../src/chain/execution";
import { decodeSwapCalldata } from "../src/chain/calldata-decoder";
import { assertSwapSafe, type SwapExpectation } from "../src/chain/calldata-guard";
import { guardSignedSwap } from "../src/chain/signed-tx-guard";
import { dexConfig } from "../src/chain/dex-config";

const env = "testnet" as const;
const TSLA = getAddress("0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E");
const USDC = getAddress("0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F");
const SELL_TSLA = parseUnits("0.05", 18); // small size — spot quote is accurate for this

const ERC20 = [
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`));
  const user = account.address;
  const router = dexConfig(env).router!;
  const wallet = createWalletClient({ account, chain: robinhoodTestnet, transport: http() });

  console.log(`signer   : ${user}`);
  console.log(`router   : ${router}`);
  const [tslaBal, usdcBefore] = await Promise.all([
    publicClient.readContract({ address: TSLA, abi: ERC20, functionName: "balanceOf", args: [user] }),
    publicClient.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [user] }),
  ]);
  console.log(`TSLA bal : ${formatUnits(tslaBal, 18)}`);
  console.log(`USDC bal : ${formatUnits(usdcBefore, 18)} (before)`);

  // 1) Live quote from the on-chain pool (real production path).
  const quote = await getQuote(env, TSLA, USDC, SELL_TSLA);
  const floor = minOut(quote.amountOut, SLIPPAGE_DEFAULT_BPS);
  console.log(`quote    : ${formatUnits(SELL_TSLA, 18)} TSLA -> ${formatUnits(quote.amountOut, 18)} USDC (${quote.route})`);
  console.log(`minOut   : ${formatUnits(floor, 18)} USDC @ ${SLIPPAGE_DEFAULT_BPS}bps`);

  // 2) Approve the router to pull TSLA (it swaps via transferFrom). Only if the allowance is short.
  const allowance = await publicClient.readContract({ address: TSLA, abi: ERC20, functionName: "allowance", args: [user, router] });
  if (allowance < SELL_TSLA) {
    console.log("approve  : allowance short — sending approve(router, amountIn)...");
    const approveHash = await wallet.writeContract({ address: TSLA, abi: ERC20, functionName: "approve", args: [router, SELL_TSLA] });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`approve  : ${approveHash} ✓`);
  } else {
    console.log("approve  : allowance already sufficient");
  }

  // 3) Build the signable calldata (real production builder) + guard it BEFORE signing (C2).
  const tx = buildSwapCalldata({ env, userAddress: user, tokenIn: TSLA, tokenOut: USDC, amountIn: SELL_TSLA, amountOutMin: floor, fee: quote.fee, deadline: 0n });
  const expected: SwapExpectation = { userAddress: user, tokenIn: TSLA, tokenOut: USDC, minOut: floor, maxIn: SELL_TSLA };
  const preGuard = assertSwapSafe(env, decodeSwapCalldata(tx.data, tx.to, user), expected);
  if (!preGuard.ok) throw new Error(`pre-sign guard rejected: ${preGuard.reason}`);
  console.log("guard    : pre-sign calldata guard ✓");

  // 4) Sign the exact tx (non-custodial: the wallet signs; we relay). Prepare fills nonce/gas/fees.
  const request = await wallet.prepareTransactionRequest({ to: tx.to, data: tx.data, value: tx.value });
  const signedRawTx = await wallet.signTransaction(request as Parameters<typeof wallet.signTransaction>[0]);

  // 5) Guard the EXACT signed bytes (the production execute-route gate).
  const signedGuard = guardSignedSwap(env, signedRawTx, expected, robinhoodTestnet.id);
  if (!signedGuard.ok) throw new Error(`signed-tx guard rejected (${signedGuard.status}): ${signedGuard.reason}`);
  console.log(`guard    : signed-tx guard ✓  nonce=${signedGuard.nonce} hash=${signedGuard.hash}`);

  // 6) Broadcast via the production seam + confirm.
  const hash = await broadcastRawTx(env, signedRawTx);
  console.log(`broadcast: ${hash} — waiting for receipt...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const usdcAfter = await publicClient.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [user] });
  console.log(`receipt  : status=${receipt.status} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed}`);
  console.log(`USDC bal : ${formatUnits(usdcAfter, 18)} (after)  Δ=+${formatUnits(usdcAfter - usdcBefore, 18)} USDC`);
  if (receipt.status !== "success") throw new Error("swap tx reverted");
  if (usdcAfter - usdcBefore < floor) throw new Error("received less than minOut — guard invariant violated on-chain");
  console.log("\n✅ live swap succeeded: quote → guard → sign → broadcast → settled, output ≥ minOut");
}

main().catch((e) => {
  console.error("\n❌ swap-smoke failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
