# `@chiefaia/atlas-mapper`

The core algorithm package for **Atlas** (CAIA Step 6) — the visual ticket-to-design mapping module. Pure-logic engine: builds a deterministic flat DOM-ID map from a canonical `RenderableDesign` tree, answers bidirectional ticket↔DOM queries, and diffs two design versions at DOM-ID level.

**No UI. No network. No LLM calls.** Atlas's parent shell, iframe renderers, and storage layer live elsewhere. This package is the pure functional core that those layers compose around.

Anchor docs:
- `research/atlas_module_spec_2026.md` §2 (DOM-like uniqueness model) and §7 (multi-source ingest contract)
- `research/step5_design_ingest_spec_2026.md` §1 (canonical `RenderableDesign` shape)

## What this package does

1. **DOM ID generation** — given a `RenderableDesign`, walks the component-tree AST and emits a flat array of `{ domId, parentDomId, role, tag, bounds, attrs }` entries. IDs are deterministic and stable across re-uploads of the same design (fingerprint = `tag + role + parent path + sibling position`).
2. **Ticket↔DOM mapping** — given a DOM map + a hierarchical ticket tree, exposes four pure-function APIs: `ticketByDomId`, `domIdsByTicket`, `nearestEnclosingTicket`, `descendantTickets`.
3. **Diff algorithm** — given two `RenderableDesign` versions, returns `{ added, removed, modified }` with a structured reason per modification (`attrs_changed | position_changed | token_changed | copy_changed | asset_changed`). This feeds Time Machine + UX Version Control downstream.

## Public API

```typescript
import {
  buildDomIdMap,
  buildMapper,
  diffDesigns,
  type RenderableDesign,
  type DomIdEntry,
  type DomIdMap,
  type Mapper,
  type DesignDiff,
  type DiffReason,
} from '@chiefaia/atlas-mapper';

// 1. Build a flat DOM-ID map from a RenderableDesign
const map: DomIdMap = buildDomIdMap(renderableDesign);
// → { entries: DomIdEntry[], byId: Map<string, DomIdEntry> }

// 2. Build a ticket↔DOM mapper given a DOM map + a hierarchical ticket tree
const mapper: Mapper = buildMapper(map, ticketTree);
mapper.ticketByDomId('page-home>section-hero');      // Ticket | null
mapper.domIdsByTicket('PG-home');                    // string[]
mapper.nearestEnclosingTicket('page-home>section-hero>button-cta>icon-0'); // Ticket | null
mapper.descendantTickets('page-home>section-hero');  // Ticket[]

// 3. Diff two design versions
const diff: DesignDiff = diffDesigns(v1, v2);
// → { added: DomIdEntry[], removed: DomIdEntry[], modified: ModifiedEntry[] }
//   where ModifiedEntry.reasons: DiffReason[] = e.g. ['attrs_changed', 'copy_changed']
```

## Stable-ID guarantee

The fingerprint for a node is `tag + role + parent-path + sibling-position`. Consequences:

- **Style change → same ID.** Editing `className`/`style` props doesn't move the fingerprint.
- **Copy change → same ID.** Inner text isn't part of the fingerprint.
- **Asset swap → same ID.** Asset refs aren't part of the fingerprint.
- **Component rename → same ID** (if `tag + role` rule resolves the same way). But the `RenderableDesign` adapter usually changes the `tag` field on rename, so renames typically show up as one ID removed + one ID added — which is the honest behaviour per spec §2.3.
- **Structural move → new ID.** Reparenting or reordering siblings shifts the fingerprint. This is correct: a moved widget is a new widget from Atlas's point of view.

Cycle detection: `buildDomIdMap` detects DOM-ID cycles in the tree (same `domId` appearing twice on the visit path) and throws `AtlasMapperError` with code `cycle_detected`. Duplicate-at-same-level IDs are also rejected (`duplicate_dom_id`).

## Determinism

`buildDomIdMap(d)` is referentially transparent on `d`: feeding the same `RenderableDesign` twice produces a deeply-equal map. The diff algorithm sorts its output deterministically so snapshot tests are stable.

## Reuse, not invention

This package consumes the `RenderableDesign` shape from `research/step5_design_ingest_spec_2026.md` §1 — see `src/renderable-design.ts` for the TypeScript projection. The ticket tree shape mirrors `@chiefaia/ticket-template`'s hierarchical-ID convention; see `src/ticket-tree.ts`.

## Performance

`buildDomIdMap` is a single AST walk, O(n) in tree size. `buildMapper` is O(n) for table construction; queries are O(1)/O(depth)/O(subtree). `diffDesigns` is O(n+m).
