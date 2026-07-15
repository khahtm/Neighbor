import { NextResponse, type NextRequest } from "next/server";
import { countryFromHeaders } from "@/lib/compliance/geo";
import { isRestrictedJurisdiction } from "@/lib/compliance/restricted-set";

/**
 * Request-path geo-gate (red-team C8). Blocks the trade API from restricted jurisdictions as a UI
 * DETERRENT — the execute route re-checks server-side (never trust the middleware alone), and this is
 * NOT a securities-compliance control. Read paths (portfolio/quote preview) are intentionally left
 * open; only the mutating trade endpoints are gated here.
 */
export function middleware(req: NextRequest) {
  const country = countryFromHeaders(req.headers);
  if (country && isRestrictedJurisdiction(country)) {
    return NextResponse.json(
      { error: "unavailable in your region", detail: `restricted jurisdiction: ${country}` },
      { status: 451 },
    );
  }
  return NextResponse.next();
}

// Gate only the mutating trade endpoints; execute re-verifies regardless.
export const config = {
  matcher: ["/api/trade/execute"],
};
