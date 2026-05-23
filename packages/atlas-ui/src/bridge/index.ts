/**
 * Re-export the bridge surface as a sub-entry point.
 *
 * Callers can `import { createBridge } from '@caia/atlas-ui/bridge'` to
 * use the bridge from a non-React context (e.g. a vanilla Next.js
 * route or a Cypress harness).
 */

export {
  createBridge,
  type AtlasBridge,
  type AtlasBridgeListener,
  type CreateBridgeOptions,
} from './parent.js';

export {
  ATLAS_PROTOCOL_VERSION,
  isAtlasMessage,
  isIframeMessage,
  isParentMessage,
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
} from './protocol.js';
