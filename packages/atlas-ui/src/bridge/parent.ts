/**
 * Parent-side iframe bridge.
 *
 * Wraps a single iframe and exposes a small, typed API for sending
 * messages and subscribing to incoming events. Owns:
 *
 *   - postMessage encoding (the wire format is JSON-compatible objects)
 *   - origin enforcement (rejects messages from unexpected origins)
 *   - listener registration + cleanup
 *   - message-id generation for correlating async replies
 *
 * Why a bridge object instead of raw `iframe.contentWindow.postMessage`:
 *
 *   - Centralises origin handling so callers can't accidentally
 *     accept messages from a third-party script that mounted in the
 *     same window.
 *   - Lets us instrument every message in tests (vitest contract
 *     suite in tests/unit/bridge/).
 *   - Lets us swap the transport later (e.g. shared worker) without
 *     touching React components.
 */

import {
  ATLAS_PROTOCOL_VERSION,
  isAtlasMessage,
  isIframeMessage,
  type AtlasClearMessage,
  type AtlasIframeToParent,
  type AtlasParentToIframe,
  type AtlasPingMessage,
  type AtlasRouteMessage,
  type AtlasSelectMessage,
} from './protocol.js';

/** Options for `createBridge`. */
export interface CreateBridgeOptions {
  /**
   * The iframe element to talk to. The bridge captures
   * `iframe.contentWindow` lazily on each send — if the iframe
   * navigates, we always pick up the current window.
   */
  iframe: HTMLIFrameElement;

  /**
   * Origin to enforce on incoming messages. Pass `"*"` to accept all
   * (only acceptable in tests and for sandboxed iframes whose origin
   * is the literal `"null"` — pass `"null"` for that case). Pass
   * the iframe's real origin in production.
   */
  expectedOrigin: string;

  /**
   * Optional override for the global `window` used for
   * `addEventListener("message")`. Defaults to the global `window`.
   * Tests pass a JSDOM window here.
   */
  window?: Window;

  /**
   * Optional logger — receives one structured record per ignored
   * message (wrong origin, malformed shape, etc.). Defaults to a
   * no-op. We deliberately do not console.warn by default to keep
   * tests quiet.
   */
  onIgnored?: (reason: string, event: MessageEvent) => void;
}

/** Subscriber callback signature. */
export type AtlasBridgeListener = (msg: AtlasIframeToParent) => void;

/** Returned from `createBridge` — the only API surface callers see. */
export interface AtlasBridge {
  /** Send `atlas:select` to the iframe. */
  select: (
    domId: string,
    opts?: { scroll?: 'smooth' | 'instant' | 'none' },
  ) => string;
  /** Send `atlas:clear` — drop any iframe-side highlight. */
  clear: () => string;
  /** Send `atlas:ping` — liveness probe. */
  ping: () => string;
  /** Send `atlas:route` — change the iframe's current route. */
  route: (path: string) => string;
  /** Send an arbitrary parent→iframe message (escape hatch). */
  send: (msg: AtlasParentToIframe) => void;
  /** Subscribe to all iframe→parent messages. Returns an unsubscribe fn. */
  on: (listener: AtlasBridgeListener) => () => void;
  /**
   * Subscribe to one specific message type — sugar over `on()` with
   * a type filter. Returns an unsubscribe fn.
   */
  onType: <T extends AtlasIframeToParent['type']>(
    type: T,
    listener: (msg: Extract<AtlasIframeToParent, { type: T }>) => void,
  ) => () => void;
  /** Tear down the bridge — removes the window-level listener. */
  destroy: () => void;
  /** Current protocol version (literal `1`). */
  protocolVersion: typeof ATLAS_PROTOCOL_VERSION;
}

/**
 * Stable monotonic id generator. We deliberately avoid `crypto.randomUUID`
 * here — the bridge runs in test (JSDOM lacks it) and in older Safari.
 */
function nextMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Create a typed bridge for one iframe.
 *
 * The returned object's methods are stable identities (bound
 * functions) so React components can pass them as deps to
 * `useEffect` without retriggering.
 */
export function createBridge(opts: CreateBridgeOptions): AtlasBridge {
  const { iframe, expectedOrigin } = opts;
  const win: Window = opts.window ?? (globalThis.window as Window);
  const onIgnored = opts.onIgnored ?? (() => {});

  if (!iframe || typeof iframe !== 'object') {
    throw new TypeError('createBridge: `iframe` must be an HTMLIFrameElement');
  }
  if (typeof expectedOrigin !== 'string' || expectedOrigin.length === 0) {
    throw new TypeError('createBridge: `expectedOrigin` must be a non-empty string');
  }

  const listeners = new Set<AtlasBridgeListener>();

  function originMatches(event: MessageEvent): boolean {
    if (expectedOrigin === '*') return true;
    // Some browsers report `"null"` (literal string) for opaque-origin
    // sandboxed iframes; some report empty string. We accept either
    // when the caller asked for `"null"`.
    if (expectedOrigin === 'null') {
      return event.origin === 'null' || event.origin === '';
    }
    return event.origin === expectedOrigin;
  }

  function handleMessage(event: MessageEvent): void {
    if (!originMatches(event)) {
      onIgnored('origin', event);
      return;
    }
    const data = event.data;
    if (!isAtlasMessage(data)) {
      onIgnored('not-atlas-shape', event);
      return;
    }
    if (!isIframeMessage(data)) {
      onIgnored('not-iframe-direction', event);
      return;
    }
    for (const l of listeners) {
      try {
        l(data);
      } catch (err) {
        onIgnored(`listener-threw:${String((err as Error)?.message ?? err)}`, event);
      }
    }
  }

  win.addEventListener('message', handleMessage as EventListener);

  function send(msg: AtlasParentToIframe): void {
    // `contentWindow` is null until the iframe has loaded its
    // first document — silently drop until then. Tests assert
    // the no-op behaviour explicitly.
    const target = iframe.contentWindow;
    if (!target) return;
    // For sandbox=allow-scripts (no allow-same-origin) the iframe's
    // origin is opaque; targetOrigin must be `"*"`. This is safe
    // because sandboxed iframes can't read parent state regardless.
    target.postMessage(msg, '*');
  }

  const select = (
    domId: string,
    sendOpts?: { scroll?: 'smooth' | 'instant' | 'none' },
  ): string => {
    const messageId = nextMessageId();
    const msg: AtlasSelectMessage = { type: 'atlas:select', domId, messageId };
    if (sendOpts && sendOpts.scroll !== undefined) msg.scroll = sendOpts.scroll;
    send(msg);
    return messageId;
  };

  const clear = (): string => {
    const messageId = nextMessageId();
    const msg: AtlasClearMessage = { type: 'atlas:clear', messageId };
    send(msg);
    return messageId;
  };

  const ping = (): string => {
    const messageId = nextMessageId();
    const msg: AtlasPingMessage = { type: 'atlas:ping', messageId };
    send(msg);
    return messageId;
  };

  const route = (path: string): string => {
    const messageId = nextMessageId();
    const msg: AtlasRouteMessage = { type: 'atlas:route', path, messageId };
    send(msg);
    return messageId;
  };

  const on = (listener: AtlasBridgeListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const onType: AtlasBridge['onType'] = (type, listener) => {
    const wrapped: AtlasBridgeListener = (m) => {
      if (m.type === type) listener(m as Parameters<typeof listener>[0]);
    };
    return on(wrapped);
  };

  const destroy = (): void => {
    win.removeEventListener('message', handleMessage as EventListener);
    listeners.clear();
  };

  return {
    select,
    clear,
    ping,
    route,
    send,
    on,
    onType,
    destroy,
    protocolVersion: ATLAS_PROTOCOL_VERSION,
  };
}
