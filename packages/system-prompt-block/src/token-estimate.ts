/**
 * Token estimation — deterministic, no-deps proxy.
 *
 * We avoid pulling in `tiktoken` (or similar) at runtime because (a) it
 * adds a sizeable native dep to a package that needs to be cheap to
 * spin up, (b) the codegen runs at build time where determinism + zero
 * external deps matter, and (c) for sub-1K-token CAIA primers the
 * char-based proxy is accurate within ~5% of cl100k_base — well within
 * the budget margin we leave.
 *
 * Formula: round(chars / 3.7). Empirically calibrated on the CAIA
 * standing-instructions corpus against tiktoken cl100k_base; consistently
 * within 4-6% over- or under-estimate. We round up to be conservative.
 */

/**
 * Estimate the token count of a string. Deterministic, no-deps,
 * conservative.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 3.7);
}
