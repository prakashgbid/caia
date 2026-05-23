/**
 * Iframe ↔ parent message protocol for Atlas.
 *
 * Spec: research/atlas_module_spec_2026.md §1.2, §1.3, §3.1, §3.2, §10.4.
 *
 * ## Wire model
 *
 * All messages are plain JSON objects of shape `{ type, ...payload }`.
 * The `type` field is a string discriminator beginning with `atlas:`
 * (any other prefix is ignored on receipt — defensive against
 * unrelated postMessages from third-party scripts that share the
 * iframe's window).
 *
 * Parent → iframe:
 *   - `atlas:select`   — highlight (and optionally scroll to) a DOM-ID
 *   - `atlas:clear`    — remove any highlight
 *   - `atlas:ping`     — liveness probe (iframe replies with `atlas:pong`)
 *   - `atlas:route`    — change the iframe's current route
 *
 * Iframe → parent:
 *   - `atlas:ready`        — iframe boot complete; emits within 500ms
 *   - `atlas:click`        — user clicked an element with `data-atlas-id`
 *   - `atlas:hover`        — user hovered an element with `data-atlas-id`
 *   - `atlas:rect`         — rect snapshot for a previously-selected DOM-ID
 *   - `atlas:not-found`    — `atlas:select` referenced a DOM-ID that
 *                            doesn't exist in this iframe's DOM
 *   - `atlas:pong`         — reply to `atlas:ping`
 *   - `atlas:route-changed`— iframe navigated (popstate / programmatic)
 *
 * ## Why this exact shape
 *
 * The §3 click→select / select→click path must be a single round-trip
 * <100ms. That means the protocol cannot require multiple messages
 * per logical event. Every parent→iframe message is fire-and-forget;
 * the iframe MAY reply (e.g. with `atlas:rect`) but parent never
 * blocks. `messageId` is included on every parent→iframe message so
 * iframe replies can be correlated when the parent cares.
 *
 * ## Origin enforcement
 *
 * In dev (`sandbox="allow-scripts"` without `allow-same-origin`) the
 * iframe's origin is the literal string `"null"` — `parent.postMessage`
 * targetOrigin must be `"*"` and the parent's origin check must accept
 * `"null"`. In prod the iframe is on a per-tenant subdomain under
 * `*.designs.caia.app` (or similar) and `createBridge` takes an
 * `expectedOrigin` to enforce.
 */

/** Pixel-space rect used for overlay drawing. */
export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ─── Parent → iframe ───────────────────────────────────────────── */

export interface AtlasSelectMessage {
  type: 'atlas:select';
  domId: string;
  scroll?: 'smooth' | 'instant' | 'none';
  messageId?: string;
}

export interface AtlasClearMessage {
  type: 'atlas:clear';
  messageId?: string;
}

export interface AtlasPingMessage {
  type: 'atlas:ping';
  messageId?: string;
}

export interface AtlasRouteMessage {
  type: 'atlas:route';
  path: string;
  messageId?: string;
}

export type AtlasParentToIframe =
  | AtlasSelectMessage
  | AtlasClearMessage
  | AtlasPingMessage
  | AtlasRouteMessage;

/* ─── Iframe → parent ───────────────────────────────────────────── */

export interface AtlasReadyMessage {
  type: 'atlas:ready';
  url: string;
  ts: number;
  protocolVersion: 1;
}

export interface AtlasClickMessage {
  type: 'atlas:click';
  domId: string;
  rect: AtlasRect;
  ts: number;
  modifiers?: { shift?: boolean; meta?: boolean; ctrl?: boolean };
}

export interface AtlasHoverMessage {
  type: 'atlas:hover';
  domId: string | null;
  rect: AtlasRect | null;
  ts: number;
}

export interface AtlasRectMessage {
  type: 'atlas:rect';
  domId: string;
  rect: AtlasRect;
  ts: number;
  replyTo?: string;
}

export interface AtlasNotFoundMessage {
  type: 'atlas:not-found';
  domId: string;
  ts: number;
  replyTo?: string;
}

export interface AtlasPongMessage {
  type: 'atlas:pong';
  ts: number;
  replyTo?: string;
}

export interface AtlasRouteChangedMessage {
  type: 'atlas:route-changed';
  path: string;
  ts: number;
}

export type AtlasIframeToParent =
  | AtlasReadyMessage
  | AtlasClickMessage
  | AtlasHoverMessage
  | AtlasRectMessage
  | AtlasNotFoundMessage
  | AtlasPongMessage
  | AtlasRouteChangedMessage;

export type AtlasMessage = AtlasParentToIframe | AtlasIframeToParent;

/** Defensive type guard — returns false for any non-atlas message. */
export function isAtlasMessage(value: unknown): value is AtlasMessage {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  return typeof t === 'string' && t.startsWith('atlas:');
}

/** Narrow guard for parent→iframe messages. */
export function isParentMessage(m: AtlasMessage): m is AtlasParentToIframe {
  return (
    m.type === 'atlas:select' ||
    m.type === 'atlas:clear' ||
    m.type === 'atlas:ping' ||
    m.type === 'atlas:route'
  );
}

/** Narrow guard for iframe→parent messages. */
export function isIframeMessage(m: AtlasMessage): m is AtlasIframeToParent {
  return !isParentMessage(m);
}

/** Current protocol version. Bumped only on breaking wire changes. */
export const ATLAS_PROTOCOL_VERSION = 1 as const;
