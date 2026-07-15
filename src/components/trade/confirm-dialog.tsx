"use client";

import type { Intent } from "@/agent/intent-schema";
import { Working } from "@/components/ui/working";

/**
 * Swap confirmation dialog (red-team C11/C2). Shows the user's ORIGINAL words next to the parsed
 * trade and the decoded calldata (recipient, token legs, amountOutMin) so what they ratify is the
 * on-chain effect, not an LLM paraphrase. Purely presentational — the panel owns the flow + signing.
 */

/** Format an 18-decimal wei string to a readable amount (all current registry tokens are 18-dec). */
function fmt18(wei: string): string {
  try {
    return (Number(BigInt(wei)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
  } catch {
    return wei;
  }
}

export interface QuotePreview {
  route: string;
  amountIn: string;
  amountOut: string;
  minOut: string;
  maxIn?: string;
  slippageBps: number;
  signable?: boolean;
  signableBlockedReason?: string | null;
  // present only once the router is wired and the calldata is built + guarded
  tx?: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number } | null;
  decoded?: { to: string; recipient: string; tokenIn: string; tokenOut: string; amountOutMin: string } | null;
}

export function ConfirmDialog(props: {
  rawText: string;
  intent: Intent;
  quote: QuotePreview | null;
  blockedReason: string | null;
  busy: boolean;
  accepted: boolean;
  onAcceptChange: (v: boolean) => void;
  requireDisclaimer: boolean; // show + require the risk checkbox (mainnet); hidden on testnet
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { rawText, intent, quote, blockedReason, busy, accepted, onAcceptChange, requireDisclaimer, onConfirm, onCancel } = props;
  // Signing is only offered when the backend built + guarded real calldata (signable). On mainnet the
  // button also waits on the disclaimer checkbox; on testnet the disclaimer is hidden (ToS is still
  // recorded server-side by the execute flow).
  const canSign = Boolean(quote?.signable) && !busy && (!requireDisclaimer || accepted);

  return (
    <div className="card warnbar" style={{ marginTop: 14 }}>
      <p className="label">Confirm swap</p>

      <p className="label" style={{ margin: "0 0 6px" }}>You said</p>
      <blockquote className="quote-said" style={{ margin: 0 }}>{rawText}</blockquote>

      <p className="label" style={{ margin: "14px 0 6px" }}>Parsed as</p>
      <p style={{ margin: 0 }}>
        <span className="pill">{intent.action.toUpperCase()}</span>{" "}
        <span className="money" style={{ fontSize: 18 }}>{intent.amount} {intent.unit}</span>{" "}
        <span className="muted">·</span> <span className="addr">{intent.asset}</span>
      </p>

      {quote && (
        <dl className="quote-grid">
          <dt>route</dt><dd>{quote.route}</dd>
          <dt>you get (est.)</dt><dd><span className="money">{fmt18(quote.amountOut)}</span> {intent.asset}</dd>
          <dt>min received</dt><dd>{fmt18(quote.minOut)} {intent.asset} <span className="muted">({quote.slippageBps}bps slippage)</span></dd>
          {quote.decoded && <><dt>router</dt><dd className="addr">{quote.decoded.to}</dd></>}
          {quote.decoded && <><dt>recipient</dt><dd className="addr">{quote.decoded.recipient}</dd></>}
        </dl>
      )}

      {quote?.signable && requireDisclaimer && (
        <label className="row" style={{ marginTop: 14, gap: 8, justifyContent: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={accepted} onChange={(e) => onAcceptChange(e.target.checked)} disabled={busy} />
          <span className="muted" style={{ fontSize: 13 }}>
            I understand this signs a real onchain swap and I accept the risk disclaimer.
          </span>
        </label>
      )}

      {blockedReason && <p className="notice">{blockedReason}</p>}

      <div className="row" style={{ marginTop: 16, justifyContent: "flex-start", gap: 10 }}>
        <button className="btn btn-primary" onClick={onConfirm} disabled={!canSign}>
          {busy ? <Working /> : "Confirm & sign ▸"}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
