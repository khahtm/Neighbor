/**
 * Global execution kill-switch (red-team C15). A single flag that pauses ALL trade execution without
 * a deploy — used when a router/oracle anomaly, an exploit, or a liquidity event makes it unsafe to
 * let swaps through. Reads-only paths (portfolio, quote preview) stay up; only the execute path gates.
 *
 * Backed by an env var so it can be flipped by ops instantly. A DB/remote-config backed switch can
 * replace this later without changing callers (the function signature is the contract).
 */

/** Truthy values that mean "paused". */
const ON = new Set(["1", "true", "on", "paused", "yes"]);

/** True when trade execution is globally paused. Defaults to NOT paused. */
export function isExecutionPaused(): boolean {
  return ON.has((process.env.EXECUTION_KILL_SWITCH ?? "").trim().toLowerCase());
}
