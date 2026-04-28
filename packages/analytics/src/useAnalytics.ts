"use client";

import { useCallback } from "react";
import { sendEvent, sendPageView, setUserProperty, identifyUser } from "./integrations/ga4";
import { useConsent } from "./consent/ConsentProvider";
import type { EventName } from "./events/taxonomy";

type EventParams = Record<string, unknown>;

interface UseAnalyticsReturn {
  /** Fire a named event (no-op if consent not granted or GA4 not loaded). */
  track: (eventName: EventName | string, params?: EventParams) => void;
  /** Fire a manual page_view (auto-fired on route change by AnalyticsProvider). */
  page: (location?: string, title?: string) => void;
  /** Set GA4 user_id (fires once per session when auth state becomes known). */
  identify: (userId: string) => void;
  /** Set a GA4 user property. */
  setProperty: (key: string, value: string) => void;
  /** True when analytics consent is granted. */
  analyticsEnabled: boolean;
}

export function useAnalytics(): UseAnalyticsReturn {
  const { preferences } = useConsent();
  const analyticsEnabled = preferences.analytics === "granted";

  const track = useCallback(
    (eventName: EventName | string, params?: EventParams) => {
      if (!analyticsEnabled) return;
      sendEvent(eventName, params);
    },
    [analyticsEnabled]
  );

  const page = useCallback(
    (location?: string, title?: string) => {
      if (!analyticsEnabled) return;
      sendPageView({
        page_location: location ?? (typeof window !== "undefined" ? window.location.href : ""),
        page_title: title ?? (typeof document !== "undefined" ? document.title : ""),
      });
    },
    [analyticsEnabled]
  );

  const identify = useCallback(
    (userId: string) => {
      if (!analyticsEnabled) return;
      identifyUser(userId);
    },
    [analyticsEnabled]
  );

  const setProperty = useCallback(
    (key: string, value: string) => {
      if (!analyticsEnabled) return;
      setUserProperty(key, value);
    },
    [analyticsEnabled]
  );

  return { track, page, identify, setProperty, analyticsEnabled };
}
