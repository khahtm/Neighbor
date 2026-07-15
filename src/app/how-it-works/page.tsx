import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Neighbor works · noncustodial AI swaps",
  description: "Exactly what happens between your words and an onchain swap: parse, price, guard, sign, settle — with your keys never leaving your wallet.",
};

/**
 * Standalone "How it works" walkthrough. Public (no auth): explains the money path end to end — the
 * natural-language parse, the live quote, every pre-sign guard, the noncustodial signature, and the
 * relay + settlement — plus the guard list, the stack, and a short FAQ. Uses the shared component
 * classes so it matches the app without pulling in the sidebar (its anchors live on the home page).
 */
const FLOW = [
  {
    n: "1",
    title: "You say it",
    body: "Type a trade in plain English — “Sell 0.05 TSLA”, “Buy $10 of NFLX”. The agent proposes a single intent (action, amount, token). A deterministic parse and the token registry then reconcile it, and anything with an unclear direction is rejected — so a cleverly-worded message can never flip a buy into a sell.",
  },
  {
    n: "2",
    title: "It gets priced",
    body: "The quote is read straight from the onchain pool (Uniswap-V3-style slot0 math on Robinhood Chain), not a third-party price feed. From that, a minimum-output floor is computed at your slippage tolerance, capped hard at 3%.",
  },
  {
    n: "3",
    title: "It gets guarded",
    body: "Before anything is signed, the built calldata is decoded and checked against what you confirmed: the router must be allowlisted, the recipient must be your own wallet, the minimum output must be at least your floor, and the input must be at most your ceiling. Any mismatch is a hard block, never a warning.",
  },
  {
    n: "4",
    title: "You sign — noncustodial",
    body: "Your embedded wallet signs the exact guarded transaction. Neighbor never sees or holds your keys. You can even log in with MetaMask: it becomes your identity while a fresh embedded wallet does the signing (external wallets cannot sign-without-broadcast, which the relay needs).",
  },
  {
    n: "5",
    title: "It settles",
    body: "The signed bytes are re-guarded one more time, persisted before broadcast (so a retry can never double-submit), then relayed to the chain. The card advances from confirming to settled, live, and the output lands in your wallet.",
  },
];

const GUARDS = [
  { t: "Intent ratification", d: "The raw text is re-parsed and cross-checked; ambiguous or injected instructions are refused." },
  { t: "Router allowlist", d: "Calldata may only target a known, vetted router address — nothing else." },
  { t: "Recipient lock", d: "The swap output must be paid to your own wallet, never a redirected address." },
  { t: "Min-output floor", d: "The encoded amountOutMin must meet the floor you confirmed — no room for a sandwich." },
  { t: "Input ceiling", d: "For exact-output orders the input is capped, closing the other side of the sandwich." },
  { t: "Slippage cap", d: "Slippage above a 3% hard cap is rejected outright on thin, young pools." },
  { t: "Signed-tx re-guard", d: "The exact bytes that will hit the chain are decoded and re-checked before broadcast." },
  { t: "Idempotency", d: "The tx is persisted by its hash before sending — a re-post returns the same swap, never a second." },
  { t: "Compliance gates", d: "A global kill-switch, geo deterrent, and risk-disclaimer gate sit ahead of every execute." },
];

const STACK = [
  { t: "Chain", d: "Robinhood Chain testnet (Arbitrum Orbit L2, ETH gas)." },
  { t: "Pools", d: "Synthra-V3 forked pools with deep USDC liquidity, discovered on-chain." },
  { t: "Router", d: "A minimal NeighborSwapRouter, exact-input single-hop, bound to the funded factory." },
  { t: "Wallet", d: "Privy embedded, noncustodial — provisioned for every user, including wallet logins." },
  { t: "Agent", d: "An OpenAI-compatible intent gateway; kept local-only on mainnet by design." },
];

const FAQ = [
  { q: "Is it custodial?", a: "No. Keys stay in your wallet. Neighbor builds and guards the transaction, but only you sign it; we merely relay the signed bytes." },
  { q: "What can I trade?", a: "Any token with a live pool on the chain. Today that includes TSLA, AMZN, NFLX, AMD, PLTR and WETH against USDC — all verified on-chain." },
  { q: "Can I use MetaMask?", a: "Yes, as a login. Trades are signed by an embedded wallet (which supports sign-without-broadcast); you fund that embedded wallet to trade." },
  { q: "What are the risks?", a: "This is a testnet build with unaudited contracts. Prices are arbitrary on testnet and quotes are spot-only, so large orders can move the price. Never trade funds you can’t lose." },
];

export default function HowItWorksPage() {
  return (
    <div className="doc">
      <header className="doc-top">
        <Link href="/" className="doc-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/neighbor-logo.png" alt="Neighbor" />
        </Link>
        <Link href="/#terminal" className="btn btn-accent">Launch app ▸</Link>
      </header>

      <main className="doc-main">
        <section className="doc-hero">
          <span className="hero-badge">● How it works</span>
          <h1 className="doc-h1">From your words to an onchain swap.</h1>
          <p className="doc-lead">
            Neighbor is a natural-language trading terminal where you stay in control of your keys.
            Here is exactly what happens between typing a sentence and settling a swap — and every
            check that runs before you ever sign.
          </p>
        </section>

        {/* Flow + live confirm-dialog preview */}
        <section className="section how" id="flow">
          <div className="section-head"><span className="section-title">The flow</span><span className="pill live">Noncustodial</span></div>
          <div className="how-grid">
            <ol className="how-steps">
              {FLOW.map((s) => (
                <li key={s.n} className="how-step">
                  <span className="how-num">{s.n}</span>
                  <div>
                    <p className="how-step-title">{s.title}</p>
                    <p className="how-step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="how-preview how-preview-sticky">
              <div className="how-preview-bar"><span /><span /><span /></div>
              <div className="how-preview-body">
                <p className="label" style={{ margin: 0 }}>Confirm swap</p>
                <p className="label" style={{ margin: "12px 0 5px" }}>You said</p>
                <div className="quote-said">Sell 0.05 TSLA</div>
                <p className="label" style={{ margin: "14px 0 5px" }}>Parsed as</p>
                <p style={{ margin: 0 }}>
                  <span className="pill">SELL</span>{" "}
                  <span className="money" style={{ fontSize: 17 }}>0.05 token</span>{" "}
                  <span className="muted">·</span> <span className="addr">TSLA</span>
                </p>
                <dl className="quote-grid">
                  <dt>route</dt><dd>Uniswap V3 0.3% (spot)</dd>
                  <dt>min received</dt><dd>0.0039 USDC <span className="muted">(100bps slippage)</span></dd>
                  <dt>router</dt><dd className="addr">allowlisted ✓</dd>
                  <dt>recipient</dt><dd className="addr">your wallet ✓</dd>
                </dl>
                <div className="row" style={{ marginTop: 16, justifyContent: "flex-start", gap: 10 }}>
                  <span className="btn btn-primary" aria-hidden>Confirm &amp; sign ▸</span>
                  <span className="btn" aria-hidden>Cancel</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Screenshot-style gallery of the three key moments */}
        <section className="section">
          <div className="section-head"><span className="section-title">See it in action</span></div>
          <div className="doc-gallery">
            <div className="gallery-item">
              <div className="how-preview">
                <div className="how-preview-bar"><span /><span /><span /></div>
                <div className="how-preview-body">
                  <p className="label" style={{ margin: 0 }}>Trade</p>
                  <div className="prompt-banner" style={{ marginTop: 10 }}>
                    <span className="prompt-text">Just say it in plain English. <b>Neighbor</b> quotes, guards, and swaps for you.</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="input" style={{ flex: 1 }}>Sell 0.05 TSLA</span>
                    <span className="btn btn-primary" aria-hidden>Preview ▸</span>
                  </div>
                  <div className="chip-row"><span className="chip-hint">Try</span><span className="chip">Buy $10 of NFLX</span><span className="chip">Buy $5 of AMD</span></div>
                </div>
              </div>
              <p className="gallery-cap">1 · Say it</p>
            </div>

            <div className="gallery-item">
              <div className="how-preview">
                <div className="how-preview-bar"><span /><span /><span /></div>
                <div className="how-preview-body">
                  <p className="label" style={{ margin: 0 }}>Confirm swap</p>
                  <p className="label" style={{ margin: "10px 0 5px" }}>You said</p>
                  <div className="quote-said">Sell 0.05 TSLA</div>
                  <dl className="quote-grid">
                    <dt>route</dt><dd>Uniswap V3 0.3%</dd>
                    <dt>min out</dt><dd>0.0039 USDC</dd>
                    <dt>router</dt><dd className="addr">allowlisted ✓</dd>
                    <dt>to</dt><dd className="addr">your wallet ✓</dd>
                  </dl>
                  <div className="row" style={{ marginTop: 14, justifyContent: "flex-start", gap: 8 }}>
                    <span className="btn btn-primary" aria-hidden>Confirm &amp; sign ▸</span>
                  </div>
                </div>
              </div>
              <p className="gallery-cap">2 · Guarded quote</p>
            </div>

            <div className="gallery-item">
              <div className="how-preview">
                <div className="how-preview-bar"><span /><span /><span /></div>
                <div className="how-preview-body">
                  <p className="label" style={{ margin: 0 }}>Swap settled</p>
                  <dl className="quote-grid">
                    <dt>state</dt><dd><span className="pill live">✓ settled</span></dd>
                    <dt>tx</dt><dd><span className="addr">0x8f6a63f9…d0d40ebf84</span></dd>
                  </dl>
                  <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>Final on Robinhood Chain — output is in your wallet.</p>
                  <div className="row" style={{ marginTop: 14, justifyContent: "flex-start" }}>
                    <span className="btn" aria-hidden>New trade</span>
                  </div>
                </div>
              </div>
              <p className="gallery-cap">3 · Settled</p>
            </div>
          </div>
        </section>

        {/* Guards */}
        <section className="section">
          <div className="section-head"><span className="section-title">The guards</span><span className="muted" style={{ fontSize: 13 }}>every one runs before broadcast</span></div>
          <div className="guard-grid">
            {GUARDS.map((g) => (
              <div className="guard-card" key={g.t}>
                <span className="guard-check">✓</span>
                <div>
                  <p className="guard-t">{g.t}</p>
                  <p className="guard-d">{g.d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Noncustodial callout */}
        <section className="section">
          <div className="doc-callout">
            <p className="doc-callout-t">Noncustodial by design</p>
            <p className="doc-callout-d">
              Your private key never leaves your wallet and never touches our servers. Neighbor assembles
              and guards the transaction, you sign it, and we only relay the already-signed bytes — which
              are re-checked one final time before they reach the chain.
            </p>
          </div>
        </section>

        {/* Stack */}
        <section className="section">
          <div className="section-head"><span className="section-title">Under the hood</span></div>
          <div className="uh-grid">
            {STACK.map((s) => (
              <div className="uh-card" key={s.t}>
                <p className="uh-t">{s.t}</p>
                <p className="uh-d">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="section">
          <div className="section-head"><span className="section-title">FAQ</span></div>
          <div className="faq">
            {FAQ.map((f) => (
              <div className="faq-item" key={f.q}>
                <p className="faq-q">{f.q}</p>
                <p className="faq-a">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="doc-cta">
          <h2 className="doc-cta-t">Ready? Just say it.</h2>
          <Link href="/#terminal" className="btn btn-accent">Start trading ▸</Link>
        </section>
      </main>
    </div>
  );
}
