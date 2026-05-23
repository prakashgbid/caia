/**
 * `@caia/atlas-ui` — public entry point.
 *
 * The React + Tailwind + shadcn-style split-screen UI for the Atlas
 * module (CAIA Step 6). All components live under `./components/`,
 * hooks under `./hooks/`, the iframe bridge under `./bridge/`, and
 * the API client under `./api/`.
 *
 * Spec: `research/atlas_module_spec_2026.md`.
 *
 * Sub-entries: `@caia/atlas-ui/bridge` (parent bridge factory),
 * `@caia/atlas-ui/iframe-bootstrap` (the script injected into the
 * sandboxed design iframe).
 */

// Components
export { AtlasShell, type AtlasShellProps } from './components/AtlasShell.js';
export { DesignPane, type DesignPaneProps } from './components/DesignPane.js';
export { TicketPane, type TicketPaneProps } from './components/TicketPane.js';
export { PromptDock, type PromptDockProps } from './components/PromptDock.js';
export {
  ScopeBoxOverlay,
  type ScopeBox,
  type ScopeBoxOverlayProps,
} from './components/ScopeBoxOverlay.js';
export {
  SelectionBreadcrumb,
  type BreadcrumbSegment,
  type SelectionBreadcrumbProps,
} from './components/SelectionBreadcrumb.js';
export {
  AgentStatusSidebar,
  type AgentStatusSidebarProps,
} from './components/AgentStatusSidebar.js';

// Hooks
export { useAtlasSelection, type UseAtlasSelectionResult } from './hooks/useAtlasSelection.js';
export { useAtlasSse, type UseAtlasSseOptions, type UseAtlasSseResult } from './hooks/useAtlasSse.js';
export { useAtlasBridge, type UseAtlasBridgeOptions } from './hooks/useAtlasBridge.js';

// API client
export {
  createAtlasApiClient,
  createHttpClient,
  createMockClient,
  type AtlasApiClient,
  type AtlasMockFixtures,
  type AtlasSseUnsubscribe,
} from './api/index.js';

// Selection helpers
export {
  selectionReducer,
  initialSelection,
  breadcrumbForSelection,
  type SelectionAction,
} from './lib/selection-reducer.js';

export {
  flattenTree,
  walkTree,
  findNode,
  ancestorIds,
  type FlatRow,
  type FlattenOptions,
} from './lib/tree-utils.js';

// Bridge
export {
  createBridge,
  ATLAS_PROTOCOL_VERSION,
  isAtlasMessage,
  isIframeMessage,
  isParentMessage,
  type AtlasBridge,
  type AtlasBridgeListener,
  type CreateBridgeOptions,
  type AtlasClearMessage,
  type AtlasClickMessage,
  type AtlasHoverMessage,
  type AtlasIframeToParent,
  type AtlasMessage,
  type AtlasNotFoundMessage,
  type AtlasParentToIframe,
  type AtlasPingMessage,
  type AtlasPongMessage,
  type AtlasReadyMessage,
  type AtlasRect,
  type AtlasRectMessage,
  type AtlasRouteChangedMessage,
  type AtlasRouteMessage,
  type AtlasSelectMessage,
} from './bridge/index.js';

// Wire types
export type {
  AtlasDesignSource,
  AtlasDesignVersion,
  AtlasLatestDesignResponse,
  AtlasRectCache,
  AtlasRendererId,
  AtlasSelection,
  AtlasSseEvent,
  AtlasTicketNode,
  AtlasTicketTree,
  AtlasTicketVersion,
  AtlasTicketVersionsResponse,
  AtlasSubmitPromptRequest,
  AtlasSubmitPromptResponse,
  AtlasAgentRunFinishedEvent,
  AtlasAgentRunStartedEvent,
  AtlasDesignRebuiltEvent,
  AtlasTicketStateChangedEvent,
  TicketLevel,
  TicketState,
} from './types/index.js';
