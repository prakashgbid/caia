/**
 * Public type surface for `@caia/atlas-ui`.
 *
 * Mirrors the §5 backend payload shapes and the §7 `RenderableDesign`
 * adapter contract. We deliberately re-declare some types instead of
 * importing them from `@chiefaia/atlas-mapper` because:
 *
 *   - `atlas-mapper` types are pure-logic (no UI-side fields like
 *     `state`, `title`, `lastPromptAt`).
 *   - `atlas-ui` consumes the wire shape that the Atlas Next.js API
 *     emits, which is a superset of the mapper's internal shape.
 *
 * The mapper types are still re-exported from the entry-point for
 * callers that need the full pipeline.
 */

/* ─── Spec §5.2 — tickets/tree shape ────────────────────────────── */

/**
 * State enum per spec §5.2. The render layer maps each value to a
 * coloured dot in the tree row (grey/blue/green/orange/red).
 */
export type TicketState =
  | 'proposed'
  | 'approved'
  | 'change-requested'
  | 'in-progress'
  | 'implemented'
  | 'verified'
  | 'orphaned'
  | 'failed';

/** Hierarchical level per `ticket_taxonomy_2026.md` §3.2. */
export type TicketLevel =
  | 'site'
  | 'foundation'
  | 'page'
  | 'section'
  | 'widget'
  | 'story'
  | 'task';

/** A single ticket node as the API returns it. */
export interface AtlasTicketNode {
  id: string;
  level: TicketLevel;
  title: string;
  state: TicketState;
  /** Bound DOM-ID, if any. Foundations bind nothing. */
  domId?: string | null;
  /** Sub-architect that owns this ticket per ownerAgent field. */
  ownerAgent?: string | null;
  /** ISO timestamp of the last submitted prompt for this ticket. */
  lastPromptAt?: string | null;
  /** Children — same shape, recursive. */
  children?: AtlasTicketNode[];
}

/** The full response from `GET tickets/tree`. */
export interface AtlasTicketTree {
  designVersionId: string;
  tree: AtlasTicketNode;
}

/* ─── Spec §5.1 — designs/latest shape ──────────────────────────── */

export type AtlasRendererId = 'cd-zip' | 'static-html' | 'sandpack';

/** Renderable design source — per §7. */
export type AtlasDesignSource =
  | 'cd-zip'
  | 'figma-json'
  | 'v0-export'
  | 'static-html'
  | 'lovable-export'
  | 'bolt-export'
  | 'builder-io-export';

export interface AtlasDesignVersion {
  id: string;
  uploadedAt: string;
  source: AtlasDesignSource;
  renderer: AtlasRendererId;
  iframeUrl: string;
  domIdManifestUrl: string;
  thumbnails: Record<string, string>;
  routes: string[];
  /** Default route (the one we render first). Defaults to `routes[0]`. */
  defaultRoute?: string;
}

export interface AtlasLatestDesignResponse {
  projectId: string;
  designVersion: AtlasDesignVersion;
}

/* ─── Spec §5.3 — prompt submission ─────────────────────────────── */

export interface AtlasSubmitPromptRequest {
  prompt: string;
  selection: string[];
  promptGroupId?: string | null;
  ts: string;
}

export interface AtlasSubmitPromptResponse {
  versionId: string;
  ticketState: TicketState;
  expectedChangeDescription: string;
  dispatchedTo: string[];
  enqueuedAt: string;
}

/* ─── Spec §5.5 — SSE events ────────────────────────────────────── */

export interface AtlasTicketStateChangedEvent {
  type: 'ticket.state-changed';
  ticketId: string;
  from: TicketState;
  to: TicketState;
  ts: string;
}

export interface AtlasAgentRunStartedEvent {
  type: 'agent.run-started';
  ticketId: string;
  agent: string;
  runId: string;
  ts: string;
}

export interface AtlasAgentRunFinishedEvent {
  type: 'agent.run-finished';
  ticketId: string;
  agent: string;
  runId: string;
  result: 'ok' | 'fail';
  prUrl?: string;
  ts: string;
}

export interface AtlasDesignRebuiltEvent {
  type: 'design.version-rebuilt';
  designVersionId: string;
  ts: string;
}

/* ─── C5 — server-emitted atlas.* events ────────────────────────── */

/**
 * `atlas.element.highlighted` — cross-pane selection sync. The atlas
 * SSE route forwards this so the design-iframe and ticket-tree can
 * track a programmatic selection (e.g. from a deep-link) without
 * round-tripping through the host app.
 */
export interface AtlasElementHighlightedEvent {
  type: 'atlas.element.highlighted';
  ticketId: string;
  domId: string;
  designVersionId: string;
  ts: string;
}

/**
 * `atlas.prompt.completed` — emitted by the worker that ran a
 * per-element prompt. `result === 'ok'` carries `versionId`.
 */
export interface AtlasPromptCompletedEvent {
  type: 'atlas.prompt.completed';
  ticketId: string;
  promptGroupId: string;
  result: 'ok' | 'fail';
  versionId?: string;
  ts: string;
}

/**
 * `atlas.version.changed` — emitted when a new design version
 * supersedes the iframe. The design-pane reloads on receipt.
 */
export interface AtlasVersionChangedEvent {
  type: 'atlas.version.changed';
  designVersionId: string;
  previousVersionId: string | null;
  ts: string;
}

export type AtlasSseEvent =
  | AtlasTicketStateChangedEvent
  | AtlasAgentRunStartedEvent
  | AtlasAgentRunFinishedEvent
  | AtlasDesignRebuiltEvent
  | AtlasElementHighlightedEvent
  | AtlasPromptCompletedEvent
  | AtlasVersionChangedEvent;

/* ─── Spec §5.6 — ticket version history ────────────────────────── */

export interface AtlasTicketVersion {
  id: string;
  ticketId: string;
  designVersionId: string;
  versionNumber: number;
  prompt: string;
  operatorUserId: string;
  createdAt: string;
  previousState: TicketState;
  newState: TicketState;
  expectedChangeDescription: string;
  dispatchedTo: string[];
  resolvedAt: string | null;
  resolutionSummary: string | null;
  resolutionPrUrl: string | null;
}

export interface AtlasTicketVersionsResponse {
  ticketId: string;
  versions: AtlasTicketVersion[];
  nextCursor?: string | null;
}

/* ─── Selection model — UI-internal, not on the wire ────────────── */

/**
 * The current selection in the Atlas shell. Both the design overlay
 * and the ticket panel render from this single source of truth.
 *
 * `domIds` is the authoritative selection; `ticketIds` is derived
 * via the mapper but cached here for component convenience.
 */
export interface AtlasSelection {
  domIds: string[];
  ticketIds: string[];
  /** The leaf-most selected element — used by the breadcrumb + dock. */
  primary: { domId: string; ticketId: string } | null;
}

/** Rect cache shared with the overlay component. */
export interface AtlasRectCache {
  byDomId: Map<string, { x: number; y: number; w: number; h: number }>;
}
