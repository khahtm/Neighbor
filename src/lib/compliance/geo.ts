/**
 * Resolve the caller's country (ISO alpha-2) from CDN/edge geo headers. Infra-agnostic: reads the
 * common Vercel / Cloudflare headers, with a local override for testing. Returns null when it cannot
 * be determined (the policy treats null as undetermined — see execution-policy). This is a DETERRENT
 * signal only; it is trivially spoofable (VPN) and is NOT a compliance control (red-team C8).
 */

/** Header names carrying the edge-resolved country, in priority order. */
const GEO_HEADERS = ["x-vercel-ip-country", "cf-ipcountry", "x-geo-country"] as const;

export function countryFromHeaders(headers: Headers): string | null {
  for (const h of GEO_HEADERS) {
    const v = headers.get(h);
    if (v && v.trim() && v.toUpperCase() !== "XX") return v.trim().toUpperCase();
  }
  // Local/dev override so the gate can be exercised without an edge in front.
  const override = process.env.GEO_COUNTRY_OVERRIDE?.trim();
  return override ? override.toUpperCase() : null;
}
