/**
 * IP anonymisation notes:
 * GA4 anonymises IP addresses by default for all properties.
 * The legacy `anonymize_ip` flag is kept in the gtag config for defence-in-depth
 * and to make the intent explicit to code readers.
 *
 * References:
 *   https://support.google.com/analytics/answer/2763052 (IP anonymisation)
 *   https://developers.google.com/analytics/devguides/collection/ga4/reference/config
 */

/** Asserts that IP anonymisation config is set correctly. Call from tests. */
export function assertIpAnonymisationConfig(gtagConfig: Record<string, unknown>): void {
  if (gtagConfig["anonymize_ip"] !== true) {
    throw new Error("anonymize_ip must be true in gtag config");
  }
}
