`@caia/atlas-ui` — Atlas split-screen UI
========================================

React + Tailwind + shadcn-style primitives for the **Atlas** module
(CAIA Step 6). Renders the bidirectional ticket-to-design mapping
surface that operators use to scope change requests to specific
elements of their running design.

Pure presentation layer:

* **No backend, no LLM calls.** The package is renderer-agnostic.
  Callers inject an `AtlasApiClient` (real HTTP, mock, or fixture).
* **Consumes [`@chiefaia/atlas-mapper`][mapper] outputs** for
  DOM-ID lookups, ticket trees, and design diffs.
* **Iframe message-bridge protocol** is the only contract between the
  Atlas parent shell and the sandboxed design iframe.

Anchor docs
-----------

* `research/atlas_module_spec_2026.md` §1 (hybrid rendering decision)
* `research/atlas_module_spec_2026.md` §3 (bidirectional selection model)
* `research/atlas_module_spec_2026.md` §4 (per-scope prompt box)
* `research/atlas_module_spec_2026.md` §6 (frontend stack)
* `research/atlas_module_spec_2026.md` §9 (accessibility — WCAG 2.2 AA)
* `research/atlas_module_spec_2026.md` §10 (verification plan)

Public surface
--------------

```tsx
import {
  AtlasShell,
  DesignPane,
  TicketPane,
  PromptDock,
  ScopeBoxOverlay,
  SelectionBreadcrumb,
  AgentStatusSidebar,
  createAtlasApiClient,
  useAtlasSelection,
  useAtlasSse,
} from '@caia/atlas-ui';

import { createBridge } from '@caia/atlas-ui/bridge';
```

Iframe bootstrap (injected once into the sandboxed design iframe):

```ts
import { installIframeBridge } from '@caia/atlas-ui/iframe-bootstrap';

installIframeBridge();
```

Iframe message-bridge protocol
------------------------------

All messages are `{ type, ... }` JSON. The parent's `MessageEvent.origin`
is checked against the per-tenant design subdomain before dispatch
(spec §1.3 — `sandbox="allow-scripts"` without `allow-same-origin` means
the iframe origin is `"null"` in dev; production runs from
`*.designs.caia.app` and the bridge enforces that).

Parent → iframe:

| `type`             | Payload                              | Effect                                  |
|--------------------|--------------------------------------|-----------------------------------------|
| `atlas:select`     | `{ domId, scroll? }`                 | Highlight + optionally scroll into view |
| `atlas:clear`      | `{}`                                 | Remove highlight                        |
| `atlas:ping`       | `{}`                                 | Liveness probe                          |
| `atlas:route`      | `{ path }`                           | Navigate the iframe                     |

Iframe → parent:

| `type`               | Payload                              |
|----------------------|--------------------------------------|
| `atlas:ready`        | `{ url, ts, protocolVersion }`       |
| `atlas:click`        | `{ domId, rect, ts, modifiers }`     |
| `atlas:hover`        | `{ domId, rect, ts }`                |
| `atlas:rect`         | `{ domId, rect, ts, replyTo? }`      |
| `atlas:not-found`    | `{ domId, ts, replyTo? }`            |
| `atlas:pong`         | `{ ts, replyTo? }`                   |
| `atlas:route-changed`| `{ path, ts }`                       |

Backend APIs the bundled `AtlasApiClient` calls:

* `GET  /api/atlas/project/:id/designs/latest`
* `GET  /api/atlas/project/:id/tickets/tree`
* `POST /api/atlas/tickets/:ticketId/prompt`
* `GET  /api/atlas/tickets/:ticketId/versions`
* `GET  /api/atlas/project/:id/events` (SSE)

Verification
------------

* `pnpm typecheck` — TypeScript strict + `exactOptionalPropertyTypes`
* `pnpm test` — Vitest (node + jsdom) — bridge protocol, reducers,
  selectors, component renders.
* `pnpm storybook:build` — Storybook static build (drives the e2e suite)
* `pnpm test:e2e` — Playwright — design-click → ticket-highlight,
  ticket-click → design-scope-box, drill up/down, submit-prompt,
  SSE event renders. Includes an axe-playwright sweep at WCAG 2.2 AA.

[mapper]: ../atlas-mapper/
