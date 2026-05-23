/**
 * Iframe-side bridge bootstrap.
 *
 * Injected once into the sandboxed design iframe. Exposes a tiny,
 * dependency-free runtime that:
 *
 *   1. Sends `atlas:ready` on DOMContentLoaded.
 *   2. Captures clicks on `[data-atlas-id]` elements and posts
 *      `atlas:click` with the element's `getBoundingClientRect`.
 *   3. Captures hover (debounced) and posts `atlas:hover`.
 *   4. Listens for parent→iframe `atlas:select` / `atlas:clear` /
 *      `atlas:ping` / `atlas:route` messages and acts on them.
 *   5. Sends `atlas:route-changed` on `popstate`.
 *
 * Spec: research/atlas_module_spec_2026.md §1.2 (Layer A bootstrap),
 *       §3.1 (click capture), §3.4 (hover preview).
 *
 * # Design constraints
 *
 *   - Zero external dependencies — must run inside Sandpack,
 *     static-HTML exports, and the customer's Next.js dev build
 *     without bundling.
 *   - Idempotent — `installIframeBridge()` checks a window-flag and
 *     no-ops on second install (the static-HTML renderer may inject
 *     the script twice in some pipelines).
 *   - Defensive — never throws into the customer's page. Wraps every
 *     handler in try/catch.
 */

import type {
  AtlasClickMessage,
  AtlasHoverMessage,
  AtlasNotFoundMessage,
  AtlasParentToIframe,
  AtlasPongMessage,
  AtlasReadyMessage,
  AtlasRect,
  AtlasRectMessage,
  AtlasRouteChangedMessage,
} from '../src/bridge/protocol.js';

/** Options for `installIframeBridge`. */
export interface InstallIframeBridgeOptions {
  /** Override `window` (tests). */
  window?: Window & typeof globalThis;
  /** Override `document` (tests). */
  document?: Document;
  /** Selector for atlas-tagged elements. Default `[data-atlas-id]`. */
  selector?: string;
  /** Hover debounce ms. Default 80. */
  hoverDebounceMs?: number;
}

/** Returned from `installIframeBridge` — lets callers tear down in tests. */
export interface InstalledIframeBridge {
  /** Manually fire `atlas:ready` again (e.g., after SPA navigation). */
  emitReady: () => void;
  /** Remove all listeners and unset the install flag. */
  destroy: () => void;
}

const INSTALL_FLAG = '__atlasIframeBridgeInstalled__';

/**
 * Read the rect of a DOM element and return our compact AtlasRect.
 * Defensive — returns null if the element is detached.
 */
function readRect(el: Element): AtlasRect | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0 && r.x === 0 && r.y === 0) return null;
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/**
 * Walk up from a node looking for the nearest atlas-tagged element.
 * Cap the walk at 32 ancestors so a deeply nested malicious page
 * can't burn CPU on every click.
 */
function nearestAtlas(node: Node | null, selector: string): Element | null {
  let cur: Node | null = node;
  let i = 0;
  while (cur && i < 32) {
    if (cur instanceof Element) {
      const match = cur.closest(selector);
      if (match) return match;
    }
    cur = cur.parentNode;
    i++;
  }
  return null;
}

/**
 * Install the bridge inside the iframe document. Returns a teardown
 * handle for tests. In production, callers don't keep the handle —
 * the iframe is destroyed when the user navigates.
 */
export function installIframeBridge(
  opts: InstallIframeBridgeOptions = {},
): InstalledIframeBridge {
  const win = opts.window ?? (globalThis.window as Window & typeof globalThis);
  const doc = opts.document ?? win.document;
  const selector = opts.selector ?? '[data-atlas-id]';
  const hoverDebounceMs = opts.hoverDebounceMs ?? 80;

  // Idempotency — second install no-ops with a working teardown.
  const winRecord = win as unknown as Record<string, unknown>;
  if (winRecord[INSTALL_FLAG] === true) {
    return { emitReady: () => {}, destroy: () => {} };
  }
  winRecord[INSTALL_FLAG] = true;

  function postToParent(msg: unknown): void {
    try {
      // Sandboxed iframes have opaque origins; parent must accept "*".
      win.parent.postMessage(msg, '*');
    } catch {
      // Cross-origin parent access can throw in degenerate test
      // setups. Swallow — we cannot recover.
    }
  }

  /* ── atlas:ready ── */

  const emitReady = (): void => {
    const msg: AtlasReadyMessage = {
      type: 'atlas:ready',
      url: String(win.location?.href ?? ''),
      ts: typeof win.performance?.now === 'function' ? win.performance.now() : Date.now(),
      protocolVersion: 1,
    };
    postToParent(msg);
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', emitReady, { once: true });
  } else {
    // Use queueMicrotask so listeners installed synchronously
    // after `installIframeBridge()` can still see the message.
    win.queueMicrotask(emitReady);
  }

  /* ── click capture ── */

  const onClick = (e: Event): void => {
    try {
      const target = e.target as Node | null;
      const el = nearestAtlas(target, selector);
      if (!el) return;
      const domId = el.getAttribute('data-atlas-id');
      if (!domId) return;
      const rect = readRect(el);
      if (!rect) return;
      const mouseEvent = e as MouseEvent;
      const msg: AtlasClickMessage = {
        type: 'atlas:click',
        domId,
        rect,
        ts: typeof win.performance?.now === 'function' ? win.performance.now() : Date.now(),
        modifiers: {
          shift: !!mouseEvent.shiftKey,
          meta: !!mouseEvent.metaKey,
          ctrl: !!mouseEvent.ctrlKey,
        },
      };
      postToParent(msg);
      // We deliberately do NOT preventDefault / stopPropagation here:
      // the customer's design may have legitimate click handlers (a
      // CTA button still needs to function). Atlas observes, doesn't
      // intercept.
    } catch {
      // never throw into customer page
    }
  };
  doc.addEventListener('click', onClick, true);

  /* ── hover capture (debounced) ── */

  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHoverId: string | null = null;

  const onPointerMove = (e: Event): void => {
    try {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        const target = e.target as Node | null;
        const el = nearestAtlas(target, selector);
        const id = el?.getAttribute('data-atlas-id') ?? null;
        if (id === lastHoverId) return;
        lastHoverId = id;
        const rect = el ? readRect(el) : null;
        const msg: AtlasHoverMessage = {
          type: 'atlas:hover',
          domId: id,
          rect,
          ts:
            typeof win.performance?.now === 'function'
              ? win.performance.now()
              : Date.now(),
        };
        postToParent(msg);
      }, hoverDebounceMs);
    } catch {
      // swallow
    }
  };
  doc.addEventListener('pointermove', onPointerMove, true);

  /* ── parent → iframe message handling ── */

  const onMessage = (event: MessageEvent): void => {
    try {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const msg = data as Partial<AtlasParentToIframe>;
      if (typeof msg.type !== 'string' || !msg.type.startsWith('atlas:')) return;

      switch (msg.type) {
        case 'atlas:select': {
          const domId = (msg as { domId?: unknown }).domId;
          if (typeof domId !== 'string' || domId.length === 0) return;
          // Use attribute selector with CSS-escaped value. CSS.escape
          // is supported everywhere we care about (Safari 14+, all
          // evergreens). Fall back to raw concat if missing.
          const cssEscape: ((s: string) => string) | undefined =
            (
              win as unknown as {
                CSS?: { escape?: (s: string) => string };
              }
            ).CSS?.escape ?? undefined;
          const safe = cssEscape ? cssEscape(domId) : domId;
          const el = doc.querySelector(`[data-atlas-id="${safe}"]`);
          const replyTo = (msg as { messageId?: string }).messageId;
          if (!el) {
            const notFound: AtlasNotFoundMessage = {
              type: 'atlas:not-found',
              domId,
              ts:
                typeof win.performance?.now === 'function'
                  ? win.performance.now()
                  : Date.now(),
              ...(typeof replyTo === 'string' ? { replyTo } : {}),
            };
            postToParent(notFound);
            return;
          }
          const scroll = (msg as { scroll?: 'smooth' | 'instant' | 'none' }).scroll;
          if (scroll !== 'none' && typeof (el as Element).scrollIntoView === 'function') {
            (el as Element).scrollIntoView({
              block: 'center',
              inline: 'center',
              behavior: scroll === 'instant' ? 'instant' : 'smooth',
            } as ScrollIntoViewOptions);
          }
          const rect = readRect(el);
          if (rect) {
            const rectMsg: AtlasRectMessage = {
              type: 'atlas:rect',
              domId,
              rect,
              ts:
                typeof win.performance?.now === 'function'
                  ? win.performance.now()
                  : Date.now(),
              ...(typeof replyTo === 'string' ? { replyTo } : {}),
            };
            postToParent(rectMsg);
          }
          break;
        }
        case 'atlas:clear': {
          // No-op at the protocol level. Concrete renderers MAY
          // additionally drop their in-iframe highlight (the
          // CD-ZIP renderer's bootstrap toggles a body class);
          // those live outside this generic bootstrap.
          break;
        }
        case 'atlas:ping': {
          const pongReplyTo = (msg as { messageId?: string }).messageId;
          const pong: AtlasPongMessage = {
            type: 'atlas:pong',
            ts:
              typeof win.performance?.now === 'function'
                ? win.performance.now()
                : Date.now(),
            ...(typeof pongReplyTo === 'string' ? { replyTo: pongReplyTo } : {}),
          };
          postToParent(pong);
          break;
        }
        case 'atlas:route': {
          // SPA renderers handle this; static-HTML iframes ignore.
          // We don't navigate the iframe directly — that's the
          // renderer's concern. Just echo back the current route
          // so parent knows it was acknowledged.
          const path = (msg as { path?: string }).path ?? String(win.location?.pathname ?? '/');
          const changed: AtlasRouteChangedMessage = {
            type: 'atlas:route-changed',
            path,
            ts:
              typeof win.performance?.now === 'function'
                ? win.performance.now()
                : Date.now(),
          };
          postToParent(changed);
          break;
        }
        default:
          // Unknown atlas:* type — ignore.
          break;
      }
    } catch {
      // swallow
    }
  };
  win.addEventListener('message', onMessage);

  /* ── popstate (SPA navigation) ── */

  const onPopstate = (): void => {
    try {
      const msg: AtlasRouteChangedMessage = {
        type: 'atlas:route-changed',
        path: String(win.location?.pathname ?? '/'),
        ts:
          typeof win.performance?.now === 'function'
            ? win.performance.now()
            : Date.now(),
      };
      postToParent(msg);
    } catch {
      // swallow
    }
  };
  win.addEventListener('popstate', onPopstate);

  /* ── teardown ── */

  const destroy = (): void => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('pointermove', onPointerMove, true);
    win.removeEventListener('message', onMessage);
    win.removeEventListener('popstate', onPopstate);
    if (hoverTimer) clearTimeout(hoverTimer);
    delete winRecord[INSTALL_FLAG];
  };

  return { emitReady, destroy };
}
