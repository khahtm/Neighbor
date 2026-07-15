import { TradeCta } from "./trade-cta";

/**
 * Markets list for the landing — token-general (Neighbor trades any token, not only equities).
 * Tokens + status are Neighbor's own verified Robinhood Chain testnet data (discovered on-chain),
 * not third-party content. TSLA has a confirmed funded USDC pool; the rest are listed tokens on the
 * chain. No fabricated prices — testnet pricing is arbitrary, so we show pair + liquidity status.
 */
interface Market {
  symbol: string;
  name: string;
  pair: string;
  status: "live" | "listed";
}

const MARKETS: Market[] = [
  { symbol: "TSLA", name: "Tesla", pair: "TSLA / USDC", status: "live" },
  { symbol: "WETH", name: "Wrapped Ether", pair: "WETH / USDC", status: "listed" },
  { symbol: "AMZN", name: "Amazon", pair: "AMZN / USDC", status: "listed" },
  { symbol: "SYN", name: "Synapse", pair: "SYN / USDC", status: "listed" },
  { symbol: "NVDA", name: "NVIDIA", pair: "NVDA / USDC", status: "listed" },
  { symbol: "LEAF", name: "Leaf", pair: "LEAF / USDC", status: "listed" },
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
