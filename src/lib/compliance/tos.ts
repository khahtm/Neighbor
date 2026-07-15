/**
 * Terms-of-service / risk-disclaimer gate (red-team C8). The user MUST have accepted the current
 * disclaimer before any execute. Acceptance is a timestamp on the User row (schema: tosAcceptedAt);
 * this module holds the pure decision so it is testable without a DB, and the version constant so a
 * future disclaimer change can force re-acceptance (compare acceptance time against the version date).
 */

/** Bump when the disclaimer text materially changes to force re-acceptance. */
export const TOS_VERSION = "2026-07-14";

/** True if the user has a non-null acceptance timestamp (accepts a Date or ISO string, or null). */
export function hasAcceptedTos(tosAcceptedAt: Date | string | null | undefined): boolean {
  return tosAcceptedAt != null;
}
