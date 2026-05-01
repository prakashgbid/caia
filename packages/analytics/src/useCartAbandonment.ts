"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  trackCartViewed,
  trackCartAbandoned,
  trackCartRecovered,
  type CartParams,
} from "./events/commerce";

export interface UseCartAbandonmentOptions extends CartParams {
  /** Skip firing cart_viewed on mount. Default: false. */
  skipViewedEvent?: boolean;
}

export interface UseCartAbandonmentReturn {
  /** Explicitly fire cart_abandoned (idempotent — fires once per mount). */
  markAbandoned: () => void;
  /** Explicitly fire cart_recovered (idempotent — fires once per mount). */
  markRecovered: () => void;
  /** Seconds elapsed since cart was mounted. */
  getTimeInCartSeconds: () => number;
}

/**
 * Tracks cart abandonment lifecycle for a cart component.
 *
 * - Fires cart_viewed on mount (unless skipViewedEvent is true)
 * - Fires cart_abandoned with time_in_cart_seconds on window beforeunload
 * - markAbandoned() / markRecovered() for explicit control (checkout flow)
 * - Both mark* functions are idempotent; only the first call fires an event
 */
export function useCartAbandonment(
  options: UseCartAbandonmentOptions = {},
): UseCartAbandonmentReturn {
  const { skipViewedEvent = false, ...cartParams } = options;

  // Keep cart params current without re-creating callbacks on every render
  const cartParamsRef = useRef<CartParams>(cartParams);
  cartParamsRef.current = cartParams;

  const mountedAt = useRef(Date.now());
  const resolved = useRef(false);

  const getTimeInCartSeconds = useCallback((): number => {
    return Math.round((Date.now() - mountedAt.current) / 1000);
  }, []);

  const markAbandoned = useCallback((): void => {
    if (resolved.current) return;
    resolved.current = true;
    trackCartAbandoned({
      ...cartParamsRef.current,
      time_in_cart_seconds: getTimeInCartSeconds(),
    });
  }, [getTimeInCartSeconds]);

  const markRecovered = useCallback((): void => {
    if (resolved.current) return;
    resolved.current = true;
    trackCartRecovered(cartParamsRef.current);
  }, []);

  // Fire cart_viewed once on mount
  useEffect(() => {
    if (!skipViewedEvent) {
      trackCartViewed(cartParamsRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire cart_abandoned when the user leaves the page
  useEffect(() => {
    window.addEventListener("beforeunload", markAbandoned);
    return () => window.removeEventListener("beforeunload", markAbandoned);
  }, [markAbandoned]);

  return { markAbandoned, markRecovered, getTimeInCartSeconds };
}
