"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ConsentProvider, useConsent } from "./consent/ConsentProvider";
import { initGa4, loadGa4Script, sendPageView, isValidMeasurementId } from "./integrations/ga4";
import { loadCloudflareAnalytics } from "./integrations/cloudflare-analytics";

interface AnalyticsProviderProps {
  children: ReactNode;
  measurementId?: string;
  appName?: string;
  /** Token for Cloudflare Web Analytics (optional, coexists with GA4). */
  cfToken?: string;
  /** Enable console debug logging. */
  debug?: boolean;
}

function AnalyticsInner({
  measurementId,
  appName,
  cfToken,
  debug,
}: Omit<AnalyticsProviderProps, "children">) {
  const { preferences } = useConsent();
  const pathname = usePathname();
  const prevPathname = useRef<string>("");
  const ga4Ready = useRef(false);

  // Load GA4 once when analytics consent is granted
  useEffect(() => {
    if (preferences.analytics !== "granted") return;
    if (ga4Ready.current) return;
    if (!measurementId) return;

    initGa4(measurementId, debug ?? false);

    if (isValidMeasurementId(measurementId)) {
      loadGa4Script(measurementId);
    }
    ga4Ready.current = true;
  }, [preferences.analytics, measurementId, debug]);

  // Load Cloudflare Analytics on mount (cookieless — no consent required)
  useEffect(() => {
    if (cfToken) loadCloudflareAnalytics(cfToken);
  }, [cfToken]);

  // Auto page-view on route change
  useEffect(() => {
    if (!ga4Ready.current) return;
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname ?? "";

    sendPageView({
      page_location: typeof window !== "undefined" ? window.location.href : pathname ?? "",
      page_title: typeof document !== "undefined" ? document.title : "",
      page_referrer: typeof document !== "undefined" ? document.referrer : "",
      app_name: appName,
    });
  }, [pathname, appName]);

  return null;
}

/**
 * Root analytics provider.
 *
 * Usage:
 *   <AnalyticsProvider measurementId={process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID} appName="pokerzeno">
 *     {children}
 *   </AnalyticsProvider>
 *
 * - Wraps the app in ConsentProvider (manages GDPR/CCPA preferences)
 * - Loads GA4 only after analytics consent is granted
 * - Loads Cloudflare Web Analytics immediately (cookieless, no consent needed)
 * - Fires a page_view on every Next.js App Router route change
 * - No-ops silently when measurementId is a placeholder (G-PLACEHOLDER-*)
 */
export function AnalyticsProvider({ children, measurementId, appName, cfToken, debug }: AnalyticsProviderProps) {
  return (
    <ConsentProvider>
      <AnalyticsInner
        measurementId={measurementId}
        appName={appName}
        cfToken={cfToken}
        debug={debug}
      />
      {children}
    </ConsentProvider>
  );
}
