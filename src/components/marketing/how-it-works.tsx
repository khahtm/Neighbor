/**
 * "How it works" — explains the noncustodial money path in four steps, next to a faithful preview of
 * the real confirm dialog (rendered with the app's own styles, so it reads as a live screenshot of the
 * flow rather than a raster image). Purely presentational.
 */
const STEPS = [
  {
    n: "1",
    title: "Say it in plain English",
    body: "Type a trade like “Sell 0.05 TSLA”. The agent turns your words into one exact intent — action, amount, token.",
  },
  {
    n: "2",
    title: "Priced and guarded",
    body: "A live quote comes straight from the onchain pool. Before you sign, the calldata is checked against a router allowlist, the recipient, and a minimum-output floor.",
  },
  {
    n: "3",
    title: "You sign, noncustodial",
    body: "Your embedded wallet signs the exact guarded transaction. Neighbor relays it but never holds your keys.",
  },
  {
    n: "4",
    title: "Settled onchain",
    body: "The swap lands on Robinhood Chain and the card moves from confirming to settled, live — output straight to your wallet.",
  },
];

export function HowItWorks() {
  return (
    <section className="section how" id="how">
      <div className="section-head">
        <span className="section-title">How it works</span>
        <span className="pill live">Noncustodial</span>
      </div>

      <div className="how-grid">
        <ol className="how-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="how-step">
              <span className="how-num">{s.n}</span>
              <div>
                <p className="how-step-title">{s.title}</p>
                <p className="how-step-body">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Live preview of the real confirm dialog (same styles as the terminal). */}
        <div className="how-preview">
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
  );
}
