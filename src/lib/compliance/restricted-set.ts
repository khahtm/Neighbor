/**
 * Restricted-jurisdiction set for the swap terminal (red-team C8).
 *
 * IMPORTANT: IP geolocation is a UI-level DETERRENT, not a securities-distribution control. Blocking
 * these countries by IP does NOT make the product compliant — it only reduces casual access from
 * jurisdictions where tokenized-equity trading is clearly restricted. Real compliance (KYC, licensing,
 * legal clearance) is the parallel non-code workstream and the hard gate before mainnet. Do not read
 * this list as "compliance done".
 *
 * Encoded as data (ISO-3166 alpha-2) so the set is auditable and extendable without touching logic.
 * UK = GB. The Robinhood-specific restricted list (RH_EXTRA) is a placeholder to be filled from
 * Robinhood's own published restrictions before mainnet — kept separate so its provenance is clear.
 */

// Core set the plan calls out explicitly: US, Canada, UK, Switzerland, UAE.
const CORE_RESTRICTED = ["US", "CA", "GB", "CH", "AE"] as const;

// Placeholder for Robinhood's additional restricted jurisdictions — POPULATE from RH's published
// list before mainnet cutover. Empty today so we never claim coverage we don't have.
const RH_EXTRA: readonly string[] = [];

const RESTRICTED = new Set<string>([...CORE_RESTRICTED, ...RH_EXTRA].map((c) => c.toUpperCase()));

/** True if the ISO alpha-2 country code is in the restricted set. Case-insensitive. */
export function isRestrictedJurisdiction(countryCode: string): boolean {
  return RESTRICTED.has(countryCode.trim().toUpperCase());
}

/** The restricted codes (sorted) — for surfacing in a block message / audit. */
export function restrictedCodes(): string[] {
  return [...RESTRICTED].sort();
}
