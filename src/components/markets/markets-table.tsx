import { TradeCta } from "./trade-cta";

/**
 * Markets list for the landing — token-general (Neighbor trades any token, not only equities).
 * Tokens + status are Neighbor's own verified Robinhood Chain testnet data (discovered on-chain by
 * enumerating the factory's pools), not third-party content. Every row here has a confirmed funded
 * USDC pool with deep liquidity, so each is actually tradeable through the terminal. No fabricated
 * prices — testnet pricing is arbitrary, so we show pair + liquidity status only.
 */
interface Market {
  symbol: string;
  name: string;
  pair: string;
  status: "live" | "listed";
}

const MARKETS: Market[] = [
  { symbol: "TSLA", name: "Tesla", pair: "TSLA / USDC", status: "live" },
  { symbol: "AMZN", name: "Amazon", pair: "AMZN / USDC", status: "live" },
  { symbol: "NFLX", name: "Netflix", pair: "NFLX / USDC", status: "live" },
  { symbol: "AMD", name: "AMD", pair: "AMD / USDC", status: "live" },
  { symbol: "PLTR", name: "Palantir", pair: "PLTR / USDC", status: "live" },
  { symbol: "WETH", name: "Wrapped Ether", pair: "WETH / USDC", status: "live" },
];

export function MarketsTable() {
  return (
    <div className="section" id="markets">
      <div className="section-head">
        <span className="section-title">Markets</span>
        <span className="muted" style={{ fontSize: 13 }}>Robinhood Chain testnet</span>
      </div>
      <div className="table">
        <div className="thead">
          <span>#</span>
          <span>Token</span>
          <span className="hide">Pair</span>
          <span>Status</span>
          <span></span>
        </div>
        {MARKETS.map((m, i) => (
          <div className="trow" key={m.symbol}>
            <span className="muted num">{i + 1}</span>
            <span className="tok">
              <span className="tok-ico">{m.symbol.slice(0, 2)}</span>
              <span>
                {m.symbol}
                <span className="tok-name" style={{ display: "block" }}>{m.name}</span>
              </span>
            </span>
            <span className="hide muted num">{m.pair}</span>
            <span>
              {m.status === "live"
                ? <span className="pill live">Live pool</span>
                : <span className="pill">Listed</span>}
            </span>
            <span style={{ textAlign: "right" }}>
              <TradeCta symbol={m.symbol} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
