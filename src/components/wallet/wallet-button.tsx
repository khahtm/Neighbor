"use client";

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { activeChain } from "@/chain/chains";
import { WalletAvatar } from "./wallet-avatar";

/**
 * Top-right wallet widget, the familiar web3 pattern: a "Connect Wallet" button when signed out, and
 * a compact address chip with a dropdown (copy / explorer / disconnect) when connected. Privy's
 * login() opens its connect modal (email + external wallets); logout() disconnects.
 */
export function WalletButton() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const address = user?.wallet?.address ?? wallets[0]?.address ?? null;

  if (!ready) return null;

  if (!authenticated || !address) {
    return <button className="btn btn-accent" onClick={login}>Connect Wallet</button>;
  }

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const explorer = activeChain.blockExplorers?.default.url;

  return (
    <div className="wallet-btn-wrap">
      <button className="wallet-chip" onClick={() => setOpen((o) => !o)}>
        <WalletAvatar address={address} className="wallet-avatar" />
        <span className="addr" style={{ fontSize: 13 }}>{short}</span>
        <span style={{ opacity: 0.55, fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <>
          <div className="wallet-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="wallet-menu">
            <button className="wallet-menu-item" onClick={() => { navigator.clipboard?.writeText(address); setOpen(false); }}>
              Copy address
            </button>
            {explorer && (
              <a className="wallet-menu-item" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                View on explorer
              </a>
            )}
            <button className="wallet-menu-item danger" onClick={() => { logout(); setOpen(false); }}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
