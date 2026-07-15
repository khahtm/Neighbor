import { WalletPanel } from "@/components/wallet/wallet-panel";
import { WalletButton } from "@/components/wallet/wallet-button";
import { TradePanel } from "@/components/trade/trade-panel";
import { Sidebar } from "@/components/shell/sidebar";
import { MarketsTable } from "@/components/markets/markets-table";

export default function Home() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="main-inner">
          <div className="topbar"><WalletButton /></div>
          {/* Hero — all copy is Neighbor-original */}
          <section className="hero">
            <span className="hero-badge">● Natural language trading</span>
            <h1 className="hero-title">Trade any token by just saying it.</h1>
            <p className="hero-sub">
              Neighbor turns plain English into noncustodial swaps on Robinhood Chain: any token,
              one sentence. You confirm the exact trade, your wallet signs, and nobody else ever
              touches your keys.
            </p>
            <div className="cta-row">
              <a className="btn btn-accent" href="#terminal">Start trading</a>
              <a className="btn btn-ghost" href="https://docs.robinhood.com/chain/" target="_blank" rel="noreferrer">
                How it works
              </a>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-logo" src="/neighbor-hero.png" alt="Neighbor" aria-hidden />
          </section>

          {/* Stats — honest, product-real figures */}
          <div className="stats">
            <div className="stat"><div className="k">Tradeable tokens</div><div className="v">6</div></div>
            <div className="stat"><div className="k">Custody</div><div className="v">Noncustodial</div></div>
            <div className="stat"><div className="k">Deterministic guards</div><div className="v">40 checks</div></div>
          </div>

          {/* Terminal */}
          <section className="section" id="terminal">
            <div className="section-head">
              <span className="section-title">Terminal</span>
              <span className="pill live">RH testnet</span>
            </div>
            <div className="grid-2">
              <div id="wallet"><WalletPanel /></div>
              <TradePanel />
            </div>
          </section>

          <MarketsTable />
        </div>
      </div>
    </div>
  );
}
