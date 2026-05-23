/**
 * `useAtlasBridge` — React binding for the iframe message bridge.
 *
 * Creates a `createBridge` instance against the supplied iframe ref
 * and tears it down on unmount. Exposes the bridge methods + a
 * subscription helper.
 */

import { useEffect, useRef, useState } from 'react';

import { createBridge, type AtlasBridge, type AtlasBridgeListener } from '../bridge/index.js';

export interface UseAtlasBridgeOptions {
  /** Ref to the iframe element. May be null on first render. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Origin enforcement. Pass `"null"` for sandboxed iframes. */
  expectedOrigin: string;
  /** Optional listener called for every incoming iframe message. */
  onMessage?: AtlasBridgeListener;
}

export function useAtlasBridge(opts: UseAtlasBridgeOptions): AtlasBridge | null {
  const [bridge, setBridge] = useState<AtlasBridge | null>(null);
  const onMessageRef = useRef(opts.onMessage);
  onMessageRef.current = opts.onMessage;

  useEffect(() => {
    const iframe = opts.iframeRef.current;
    if (!iframe) return;
    const b = createBridge({ iframe, expectedOrigin: opts.expectedOrigin });
    const unsub = b.on((m) => onMessageRef.current?.(m));
    setBridge(b);
    return () => {
      unsub();
      b.destroy();
      setBridge(null);
    };
    // We intentionally re-run only when iframe identity or origin changes.
    // The onMessage callback is captured via ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.iframeRef.current, opts.expectedOrigin]);

  return bridge;
}
