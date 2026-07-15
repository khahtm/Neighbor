"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets, useSignTransaction, useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData } from "viem";
import type { Intent } from "@/agent/intent-schema";
import { publicClient, erc20Allowance } from "@/chain/client";
import { activeChain, CHAIN_ENV } from "@/chain/chains";
import { ConfirmDialog, type QuotePreview } from "./confirm-dialog";
import { Working } from "@/components/ui/working";

/**
 * Trade terminal (Phase 4 UI). Drives the non-custodial money path client-side: NL preview
 * (/api/chat) -> guarded quote (/api/trade/quote) -> approve tokenIn if needed -> sign the guarded
 * swap in the embedded wallet -> relay to /api/trade/execute (which re-guards the exact signed bytes,
 * C2, and persists before broadcast, C4). On testnet the router is deployed so the full path is live;
 * on mainnet the quote is seam-gated (no router) and the flow stops at the confirm dialog.
 */

const ERC20_APPROVE_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

type SubmitResult = { txId: string; hash: string; state: string; confirmations?: number; final?: boolean; finalityDepth?: number };

// One-tap example prompts — fill the terminal + preview so a new user can act without typing.
// All resolve to tokens with a live testnet pool, so the click lands on a real quote.
const TRADE_EXAMPLES = ["Sell 0.05 TSLA", "Buy $10 of TSLA", "Buy $5 of WETH"];

type ChatResponse = {
  rawUserText: string;
  outcome:
    | { status: "ok"; intent: Intent }
    | { status: "clarify"; reason: string }
    | { status: "reject"; reason: string };
};

export function TradePanel() {
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { sendTransaction } = useSendTransaction();
  // Sign/switch with the EMBEDDED (Privy) wallet specifically — wallets[0] can be an external
  // connected wallet, and Privy's sign/send need the exact address or they throw "no wallet found".
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = wallet?.address ?? user?.wallet?.address ?? null;

  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ rawText: string; intent: Intent } | null>(null);
  const [quote, setQuote] = useState<QuotePreview | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setPending(null);
    setQuote(null);
    setBlocked(null);
    setAccepted(false);
    setResult(null);
  }

  // A "Trade" button in the markets table dispatches this: prefill the terminal + auto-preview.
  useEffect(() => {
    function onTrade(e: Event) {
      const symbol = (e as CustomEvent<{ symbol: string }>).detail?.symbol;
      if (!symbol) return;
      // Default to SELL: the testnet faucet gives stock tokens (not USDC), so selling a held token
      // for USDC is the direction users can actually execute. They can edit the command to buy.
      const cmd = `Sell 0.05 ${symbol}`;
      setText(cmd);
      document.getElementById("terminal")?.scrollIntoView({ behavior: "smooth", block: "start" });
      void preview(cmd);
    }
    window.addEventListener("neighbor:trade", onTrade as EventListener);
    return () => window.removeEventListener("neighbor:trade", onTrade as EventListener);
  }, [address]);

  // Poll settlement after a swap is submitted so the card advances pending -> confirmed live, instead
  // of freezing on "swap_pending". Stops once the tx is final (or the card is cleared).
  const txId = result?.txId;
  const isFinal = result?.final ?? false;
  useEffect(() => {
    if (!txId || isFinal) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/trade/status?txId=${txId}`);
        const d = await res.json();
        if (!cancelled && res.ok) {
          setResult((r) => (r && r.txId === d.txId ? { ...r, state: d.state, confirmations: d.confirmations, final: d.final, finalityDepth: d.finalityDepth } : r));
        }
      } catch {
        /* transient RPC/DB hiccup — the next tick retries */
      }
    }
    void poll();
    const id = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, [txId, isFinal]);

  async function preview(override?: string) {
    const t = (override ?? text).trim();
    if (!t) return;
    setNotice(null);
    reset();
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const data = (await res.json()) as ChatResponse;
      if (data.outcome.status !== "ok") {
        setNotice(data.outcome.reason);
        return;
      }
      setPending({ rawText: data.rawUserText, intent: data.outcome.intent });
      await fetchQuote(data.rawUserText, data.outcome.intent);
    } catch (e) {
      setNotice(`Request failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function fetchQuote(rawText: string, intent: Intent) {
    if (!address) {
      setBlocked("Connect a wallet to fetch a quote.");
      return;
    }
    const res = await fetch("/api/trade/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userAddress: address, text: rawText, intent }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBlocked(data.detail ?? data.error ?? "Quote unavailable.");
      return;
    }
    setQuote(data as QuotePreview);
    // On networks without a deployed router (e.g. mainnet) the quote is priced but not signable.
    if (!data.signable) {
      setBlocked(data.signableBlockedReason ?? "Live price shown. Onchain signing isn't available on this network yet.");
    }
  }

  // Link the Privy user to a DB user row and record risk-disclaimer acceptance — the execute route
  // (C8) refuses without both. Returns the DB userId used as the execute owner.
  async function ensureUserAndTos(addr: string): Promise<string> {
    if (!user) throw new Error("not signed in");
    const linkRes = await fetch("/api/user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authId: user.id, address: addr, chainEnv: CHAIN_ENV }),
    });
    const link = await linkRes.json();
    if (!linkRes.ok) throw new Error(link.detail ?? link.error ?? "could not link wallet");
    const tosRes = await fetch("/api/compliance/tos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: link.userId }),
    });
    const tos = await tosRes.json();
    if (!tosRes.ok) throw new Error(tos.detail ?? tos.error ?? "could not record acceptance");
    return link.userId as string;
  }

  async function confirm() {
    if (!quote?.signable || !quote.tx || !quote.decoded) {
      setBlocked("This quote isn't signable yet (no deployed router for this network).");
      return;
    }
    if (!pending || !wallet || !address) {
      setBlocked("Connect a wallet to sign.");
      return;
    }
    setBusy(true);
    setBlocked(null);
    try {
      // Swaps can only be signed on Robinhood Chain — switch first (Privy adds it from supportedChains).
      if (wallet.chainId !== `eip155:${activeChain.id}`) await wallet.switchChain(activeChain.id);

      const userId = await ensureUserAndTos(address);

      // The router pulls tokenIn via transferFrom, so approve it first (only if the allowance is
      // short). Approve MAX once, not the exact amountIn: an exact approval is consumed by the swap,
      // so every later swap would re-approve — and an approval that isn't yet in effect makes the swap
      // estimate as reverting, which wallets round up to a huge gas limit ("network suggested" gas in
      // the thousands of ETH). A standing allowance to our own minimal router avoids that entirely.
      const tokenIn = quote.decoded.tokenIn as `0x${string}`;
      const router = quote.decoded.to as `0x${string}`;
      const amountIn = BigInt(quote.maxIn ?? quote.amountIn);
      const MAX_UINT256 = (1n << 256n) - 1n;
      if ((await erc20Allowance(tokenIn, address as `0x${string}`, router)) < amountIn) {
        const approveData = encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [router, MAX_UINT256] });
        const { hash } = await sendTransaction(
          { to: tokenIn, data: approveData, value: "0x0", chainId: activeChain.id },
          { address },
        );
        await publicClient.waitForTransactionReceipt({ hash });
        // Poll until the new allowance is actually visible on the RPC we'll estimate/sign against.
        // Without this, gas can be estimated against a still-reverting swap → a garbage gas limit
        // (a signed tx that "wants" thousands of ETH and fails to broadcast).
        for (let i = 0; i < 12; i++) {
          if ((await erc20Allowance(tokenIn, address as `0x${string}`, router)) >= amountIn) break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Pin EVERY gas field from real chain values (allowance is now in place). The embedded wallet
      // otherwise re-estimates against its own node — which can still see the swap as reverting — and
      // signs a tx with a wildly inflated gas limit / maxFeePerGas ("gas very high"). Pinning gasLimit
      // + EIP-1559 fees bounds the fee to the true ~0.0000017 ETH and can't blow up. Fail fast if the
      // swap would still revert rather than signing garbage.
      let gasLimit: bigint;
      let maxFeePerGas: bigint;
      let maxPriorityFeePerGas: bigint;
      try {
        const est = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: quote.tx.to,
          data: quote.tx.data,
          value: BigInt(quote.tx.value),
        });
        gasLimit = (est * 3n) / 2n; // +50% headroom
        const fees = await publicClient.estimateFeesPerGas();
        maxFeePerGas = fees.maxFeePerGas;
        maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
      } catch {
        setBlocked("Swap would revert onchain (check token balance and approval). Not signing.");
        return;
      }

      // Sign the EXACT guarded calldata (non-custodial: the embedded wallet signs; we never hold keys).
      const { signature } = await signTransaction(
        {
          to: quote.tx.to,
          data: quote.tx.data,
          value: quote.tx.value,
          chainId: quote.tx.chainId,
          type: 2, // EIP-1559 — pin the fee cap so the wallet can't inflate it
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
        },
        { address },
      );

      // Relay the signed bytes — the backend re-guards them (C2) and persists before broadcast (C4).
      const res = await fetch("/api/trade/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userAddress: address,
          userId,
          text: pending.rawText,
          intent: pending.intent,
          minOut: quote.minOut,
          maxIn: quote.maxIn ?? quote.amountIn,
          signedRawTx: signature,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBlocked(data.detail ?? data.error ?? "Execution rejected.");
        return;
      }
      setResult({ txId: data.txId, hash: data.hash, state: data.state });
    } catch (e) {
      setBlocked((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="card">
        <p className="label">Trade</p>
        <span className="muted">Sign in to trade.</span>
      </div>
    );
  }

  return (
    <section className="card">
      <p className="label">Trade</p>

      <div className="prompt-banner">
        <span className="prompt-text">Just say it in plain English. <b>Neighbor</b> quotes, guards, and swaps for you.</span>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <input
          className="input prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Sell 0.05 TSLA"
          onKeyDown={(e) => e.key === "Enter" && text.trim() && preview()}
        />
        <button className="btn btn-primary" onClick={() => preview()} disabled={busy || !text.trim()}>
          {busy ? <Working /> : "Preview ▸"}
        </button>
      </div>

      <div className="chip-row">
        <span className="chip-hint">Try</span>
        {TRADE_EXAMPLES.map((ex) => (
          <button key={ex} className="chip" onClick={() => { setText(ex); void preview(ex); }} disabled={busy}>
            {ex}
          </button>
        ))}
      </div>

      {notice && <p className="notice">{notice}</p>}

      {result ? (
        <div className="card warnbar" style={{ marginTop: 14 }}>
          <p className="label">{result.final ? "Swap settled" : "Swap submitted"}</p>
          <dl className="quote-grid">
            <dt>state</dt>
            <dd>
              {result.final ? (
                <span className="pill live">✓ settled</span>
              ) : (
                <span className="pill pending-pill">
                  confirming{typeof result.confirmations === "number" ? ` · ${result.confirmations}${result.finalityDepth ? `/${result.finalityDepth}` : ""}` : ""}
                </span>
              )}
            </dd>
            <dt>tx</dt>
            <dd>
              <a className="addr" href={`${activeChain.blockExplorers?.default.url}/tx/${result.hash}`} target="_blank" rel="noreferrer">
                {`${result.hash.slice(0, 14)}…${result.hash.slice(-10)}`}
              </a>
            </dd>
          </dl>
          <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            {result.final
              ? "Final on Robinhood Chain — output is in your wallet."
              : "Soft confirmed on submit; watching for finality…"}
          </p>
          <div className="row" style={{ marginTop: 14, justifyContent: "flex-start" }}>
            <button className="btn" onClick={() => { reset(); setNotice(null); setText(""); }}>New trade</button>
          </div>
        </div>
      ) : (
        pending && (
          <ConfirmDialog
            rawText={pending.rawText}
            intent={pending.intent}
            quote={quote}
            blockedReason={blocked}
            busy={busy}
            accepted={accepted}
            onAcceptChange={setAccepted}
            requireDisclaimer={CHAIN_ENV === "mainnet"}
            onConfirm={confirm}
            onCancel={() => {
              reset();
              setNotice(null);
            }}
          />
        )
      )}
    </section>
  );
}
