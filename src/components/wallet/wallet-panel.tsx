"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { formatEther, formatUnits } from "viem";
import { publicClient, erc20BalanceOf } from "@/chain/client";
import { registryFor } from "@/chain/token-registry";
import { activeChain, CHAIN_ENV, FAUCET_URL_TESTNET } from "@/chain/chains";
import { WalletAvatar } from "./wallet-avatar";

/**
 * Wallet panel — login, provisioned non-custodial address, native ETH balance.
 * Links the user↔wallet on the backend (public address only). Token balances land in Phase 4.
 */
export function WalletPanel() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [ethBalance, setEthBalance] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<{ symbol: string; amount: string }[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState<string | null>(null);

  // Show the EMBEDDED (Privy) wallet — it is the one the money path signs with and the one the user
  // must fund, even when they logged in with an external wallet like MetaMask.
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = wallet?.address ?? user?.wallet?.address ?? null;
  // Privy reports chainId as CAIP-2 ("eip155:46630"). Treat an unknown chain as ok (no false warning).
  const onCorrectChain = !wallet?.chainId || wallet.chainId === `eip155:${activeChain.id}`;

  // A swap can only be signed while the wallet is on Robinhood Chain — switch (adding it if the wallet
  // doesn't have it; Privy knows it from supportedChains) before any signing.
  async function switchNetwork() {
    if (!wallet) return;
    setSwitching(true);
    setSwitchErr(null);
    try {
      await wallet.switchChain(activeChain.id);
    } catch (e) {
      setSwitchErr((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }

  // Persist user↔wallet link once we have an address.
  useEffect(() => {
    if (!authenticated || !address || !user) return;
    void fetch("/api/user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authId: user.id, address, chainEnv: CHAIN_ENV }),
    }).catch(() => {}); // DB may not be configured yet (503) — non-fatal for the wallet UI
  }, [authenticated, address, user]);

  // Read native ETH balance from the public RPC.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void publicClient
      .getBalance({ address: address as `0x${string}` })
      .then((b) => !cancelled && setEthBalance(formatEther(b)))
      .catch(() => !cancelled && setEthBalance(null));
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Read ERC-20 balances for the registry tokens; show the ones the wallet actually holds.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const tokens = Object.values(registryFor(CHAIN_ENV)).filter((t) => t.address);
    void Promise.all(
      tokens.map(async (t) => ({
        symbol: t.symbol,
        raw: await erc20BalanceOf(t.address!, address as `0x${string}`).catch(() => 0n),
        decimals: t.decimals,
      })),
    ).then((rows) => {
      if (cancelled) return;
      setHoldings(rows.filter((r) => r.raw > 0n).map((r) => ({ symbol: r.symbol, amount: formatUnits(r.raw, r.decimals) })));
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!ready) return <div className="card"><p className="label">Loading…</p></div>;

  if (!authenticated) {
    return (
      <div className="card">
        <p className="label">Wallet</p>
        <div className="row">
          <span className="muted">Sign in to spin up a noncustodial wallet.</span>
          <button className="btn btn-primary" onClick={login}>Sign in</button>
        </div>
      </div>
    );
  }

  const fmt = (v: string | null) => (v == null ? "…" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 }));

  return (
    <div className="card">
      <div className="row">
        <p className="label" style={{ margin: 0 }}>Wallet</p>
        <span className={onCorrectChain ? "pill live" : "pill"}>{activeChain.name}</span>
      </div>

      <div className="wallet-id">
        <WalletAvatar address={address ?? "0x0"} className="wallet-avatar lg" />
        <span className="addr">{address ? `${address.slice(0, 12)}…${address.slice(-8)}` : "provisioning…"}</span>
      </div>

      <div className="holdings">
        <div className="holding">
          <span className="tok-ico sm eth">Ξ</span>
          <span className="holding-sym">ETH<span className="tok-name" style={{ display: "block" }}>Robinhood Chain</span></span>
          <span className="holding-amt money">{fmt(ethBalance)}</span>
        </div>
        {holdings.map((h) => (
          <div className="holding" key={h.symbol}>
            <span className="tok-ico sm">{h.symbol.slice(0, 2)}</span>
            <span className="holding-sym">{h.symbol}</span>
            <span className="holding-amt">{fmt(h.amount)}</span>
          </div>
        ))}
      </div>

      {!onCorrectChain && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="notice" style={{ margin: 0 }}>Wrong network</span>
          <button className="btn btn-accent" onClick={switchNetwork} disabled={switching}>
            {switching ? "Switching…" : `Switch to ${activeChain.name}`}
          </button>
        </div>
      )}
      {switchErr && <p className="notice">{switchErr}</p>}

      <div className="row" style={{ marginTop: 14 }}>
        {CHAIN_ENV === "testnet" ? (
          <a className="btn btn-ghost" href={FAUCET_URL_TESTNET} target="_blank" rel="noreferrer">Fund · Faucet</a>
        ) : <span />}
        <button className="btn" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
