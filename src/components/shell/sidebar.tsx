import { FAUCET_URL_TESTNET } from "@/chain/chains";

/**
 * App-shell left navigation. Terminal/Wallet/Markets are live and scroll to their sections; the
 * "Soon" items are the planned surface (portfolio, automations, discover, leaderboard, activity,
 * token launch, agent + API) shown so the roadmap is visible. Docs/Faucet are real external links.
 */
export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-logo" src="/neighbor-logo.png" alt="Neighbor" />
      </div>

      <div className="nav-new">+ New order</div>

      <div className="nav-group">Trade</div>
      <a className="nav-item active" href="#terminal"><span className="ico">◧</span> Terminal</a>
      <a className="nav-item" href="#wallet"><span className="ico">▣</span> Wallet</a>
      <div className="nav-item soft"><span className="ico">◔</span> Portfolio <span className="nav-badge">Soon</span></div>
      <div className="nav-item soft"><span className="ico">◑</span> Automations <span className="nav-badge">Soon</span></div>

      <div className="nav-group">Explore</div>
      <a className="nav-item" href="#markets"><span className="ico">≣</span> Markets</a>
      <div className="nav-item soft"><span className="ico">◎</span> Discover <span className="nav-badge">Soon</span></div>
      <div className="nav-item soft"><span className="ico">▤</span> Leaderboard <span className="nav-badge">Soon</span></div>
      <div className="nav-item soft"><span className="ico">◷</span> Activity <span className="nav-badge">Soon</span></div>

      <div className="nav-group">Build</div>
      <div className="nav-item soft"><span className="ico">◆</span> Launch token <span className="nav-badge">Soon</span></div>
      <div className="nav-item soft"><span className="ico">◫</span> Agent &amp; API <span className="nav-badge">Soon</span></div>

      <div className="nav-group">Resources</div>
      <a className="nav-item" href="https://docs.robinhood.com/chain/" target="_blank" rel="noreferrer">
        <span className="ico">◈</span> RH Chain docs
      </a>
      <a className="nav-item" href={FAUCET_URL_TESTNET} target="_blank" rel="noreferrer">
        <span className="ico">⛽</span> Testnet faucet
      </a>

      <div className="sidebar-foot">
        <span className="pill live">Noncustodial</span>
      </div>
    </aside>
  );
}
