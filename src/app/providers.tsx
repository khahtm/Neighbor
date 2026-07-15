"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { robinhoodMainnet, robinhoodTestnet, activeChain } from "@/chain/chains";

/**
 * Privy = non-custodial embedded wallets. We NEVER receive or store the user's private key;
 * signing happens client-side inside Privy. Robinhood Chain is a custom EVM chain here
 * (spike A: supported via custom-chain config; live-verify embedded signing on chainId 46630).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Fail loud in dev if the app id is missing rather than silently rendering a broken auth flow.
  if (!appId) {
    return (
      <div style={{ padding: 24, fontFamily: "monospace" }}>
        Missing <code>NEXT_PUBLIC_PRIVY_APP_ID</code>. Set it in <code>.env</code> (from dashboard.privy.io).
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        embeddedWallets: {
          // Auto-provision a non-custodial wallet for every user on login.
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        supportedChains: [robinhoodTestnet, robinhoodMainnet],
        defaultChain: activeChain,
        appearance: { walletChainType: "ethereum-only" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
