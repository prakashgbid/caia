/**
 * Cloudflare Web Analytics coexistence helper.
 *
 * CF Analytics (the free beacon.min.js) is cookieless and always-on — it doesn't
 * require consent because it collects no personal data. GA4 is consent-gated and
 * provides deep event data. Both are loaded; they serve different purposes:
 *
 *   CF Analytics → cookieless pageview counts, Core Web Vitals (always active)
 *   GA4           → rich event taxonomy, funnel analysis (requires consent)
 */

let _cfLoaded = false;

/** Inject the Cloudflare Web Analytics beacon. Safe to call unconditionally. */
export function loadCloudflareAnalytics(token: string): void {
  if (_cfLoaded || !token || typeof document === "undefined") return;
  _cfLoaded = true;

  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute("data-cf-beacon", JSON.stringify({ token }));
  document.head.appendChild(script);
}

export function _resetCfForTesting(): void {
  _cfLoaded = false;
}
