/**
 * Offline self-check for the Phase 6 compliance policy (red-team C8/C15). Exercises the deterministic
 * restricted-set, execution policy, kill-switch, ToS, and geo-header logic — no DB, RPC, or edge.
 * Run: `npm run check:compliance`.
 */
import assert from "node:assert";
import { isRestrictedJurisdiction, restrictedCodes } from "../src/lib/compliance/restricted-set";
import { evaluateExecutionPolicy } from "../src/lib/compliance/execution-policy";
import { isExecutionPaused } from "../src/lib/kill-switch";
import { hasAcceptedTos } from "../src/lib/compliance/tos";
import { countryFromHeaders } from "../src/lib/compliance/geo";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// ---- restricted set (C8) ----
check("core restricted jurisdictions are blocked, case-insensitive", () => {
  for (const c of ["US", "CA", "GB", "CH", "AE", "us", "gb"]) assert.equal(isRestrictedJurisdiction(c), true);
});
check("non-restricted jurisdictions pass", () => {
  for (const c of ["VN", "SG", "JP", "DE"]) assert.equal(isRestrictedJurisdiction(c), false);
});
check("UK is encoded as GB, not UK", () => {
  assert.equal(isRestrictedJurisdiction("GB"), true);
  assert.equal(restrictedCodes().includes("GB"), true);
});

// ---- execution policy (C8/C15) ----
const base = { paused: false, requestChainEnv: "testnet" as const, txChainEnv: "testnet" as const, country: "VN" };
check("kill-switch paused blocks with 503", () => {
  const d = evaluateExecutionPolicy({ ...base, paused: true });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 503);
});
check("cross-env execute refused with 409", () => {
  const d = evaluateExecutionPolicy({ ...base, txChainEnv: "mainnet" });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 409);
});
check("restricted jurisdiction blocked with 451", () => {
  const d = evaluateExecutionPolicy({ ...base, country: "US" });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 451);
});
check("clean request is allowed; undetermined country is not blocked", () => {
  assert.equal(evaluateExecutionPolicy(base).allowed, true);
  assert.equal(evaluateExecutionPolicy({ ...base, country: null }).allowed, true);
});
check("kill-switch precedes geo (paused + restricted => 503, not 451)", () => {
  const d = evaluateExecutionPolicy({ ...base, paused: true, country: "US" });
  if (!d.allowed) assert.equal(d.status, 503);
});

// ---- kill-switch env parsing ----
check("kill-switch reads truthy env values", () => {
  const prev = process.env.EXECUTION_KILL_SWITCH;
  process.env.EXECUTION_KILL_SWITCH = "on";
  assert.equal(isExecutionPaused(), true);
  process.env.EXECUTION_KILL_SWITCH = "";
  assert.equal(isExecutionPaused(), false);
  if (prev === undefined) delete process.env.EXECUTION_KILL_SWITCH;
  else process.env.EXECUTION_KILL_SWITCH = prev;
});

// ---- ToS gate ----
check("hasAcceptedTos only when a timestamp is present", () => {
  assert.equal(hasAcceptedTos(null), false);
  assert.equal(hasAcceptedTos(undefined), false);
  assert.equal(hasAcceptedTos(new Date()), true);
  assert.equal(hasAcceptedTos("2026-07-14T00:00:00.000Z"), true);
});

// ---- geo header resolution ----
check("country resolves from edge headers by priority", () => {
  assert.equal(countryFromHeaders(new Headers({ "x-vercel-ip-country": "us" })), "US");
  assert.equal(countryFromHeaders(new Headers({ "cf-ipcountry": "vn" })), "VN");
  assert.equal(countryFromHeaders(new Headers({ "x-vercel-ip-country": "XX" })), null); // XX = unknown
});
check("geo override drives the gate when no header present", () => {
  const prev = process.env.GEO_COUNTRY_OVERRIDE;
  process.env.GEO_COUNTRY_OVERRIDE = "us";
  assert.equal(countryFromHeaders(new Headers()), "US");
  if (prev === undefined) delete process.env.GEO_COUNTRY_OVERRIDE;
  else process.env.GEO_COUNTRY_OVERRIDE = prev;
});

console.log(`\n[check-compliance] ${passed} checks passed`);
