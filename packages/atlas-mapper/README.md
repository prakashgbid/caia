## `@chiefaia/atlas-mapper`

The core algorithm package for **Atlas** (CAIA Step 6) — the visual ticket-to-design mapping module. Pure-logic engine: assigns stable AST-shape-fingerprint DOM-IDs to a `RenderableDesign`, builds the bidirectional `dom_id ↔ ticket_id` mapping, and diffs two design versions.

**No UI. No network. No LLM calls.** Atlas's parent shell, iframe renderers, and storage layer live elsewhere. This package is the pure functional core those layers compose around.

Anchor docs:
- `research/atlas_module_spec_2026.md` §2 (DOM-like uniqueness), §3 (bidirectional selection), §7 (multi-source adapter contract)
- `research/step5_design_ingest_spec_2026.md` §1 (canonical `RenderableDesign` shape)

### Public API

```ts
import {
  assignStableDomIds,
  buildDomIdMap,
  buildMapper,
  diff,
  parseJsxToRenderableDesign,
  type RenderableDesign,
  type DomIdMap,
  type Mapper,
  type DesignDiff,
} from '@chiefaia/atlas-mapper';

// 1. Assign stable DOM-IDs to every node in a RenderableDesign.
//    Adapter-supplied IDs win; missing IDs are derived from
//    `tag-slug:role:position` fingerprints chained by parent path.
const stabilised: RenderableDesign = assignStableDomIds(renderableDesign);

// 2. Flatten the tree to a O(1)-lookup table.
const map: DomIdMap = buildDomIdMap(stabilised);

// 3. Build the bidirectional mapper over a hierarchical ticket tree.
const mapper: Mapper = buildMapper(map, ticketTree);
mapper.ticketByDomId(domId);            // Ticket | null    — O(1)
mapper.domIdsByTicket(ticketId);        // string[]         — O(k log k)
mapper.nearestEnclosingTicket(domId);   // Ticket | null    — O(depth)
mapper.descendantTickets(domId);        // Ticket[]         — O(subtree)

// 4. Structural diff between two versions of the same design.
const dr: DesignDiff = diff(v1, v2);
// dr.added / dr.removed / dr.modified — each modified carries
// `reasons: DiffReason[]` ∈ {attrs_changed, position_changed,
// token_changed, copy_changed, asset_changed}.

// 5. (Optional) Convert raw JSX source into a RenderableDesign via
//    ts-morph. Used by the prakash-tiwari golden test.
const rd = parseJsxToRenderableDesign({
  designVersionId: 'dv_x',
  files: [{ filePath: 'home.jsx', source: jsxText, routePath: '/' }],
});
```

### Stable-ID guarantee

The fingerprint of a node is `slugifyTag(tag):role:sibling-position`, chained by the parent's full ID with `>`. The fingerprint inputs deliberately exclude:

- `className` / inline `style` / any other entry of `attrs`
- inner text / `copyRefs`
- asset refs / `resolvedStyle` / design tokens
- bounds / screenshots

Consequence: an element keeps its DOM-ID across restyling, copy edits, asset swaps, and token remaps. The ID changes only when the structure changes — different tag, different role, different parent path, or different sibling position. This is the "structural-move → new ID" rule from atlas spec §2.3 and is what makes Atlas's across-revision diff honest.

### Failure modes

Every error is an `AtlasMapperError` with a stable `code` (no string parsing):

| code | when |
|---|---|
| `cycle_detected` | same DOM-ID on the visit path twice (tree has a self-reference) |
| `duplicate_dom_id` | two distinct nodes resolve to the same DOM-ID |
| `invalid_renderable_design` | top-level shape is broken (missing `designVersionId`, etc.) |
| `invalid_ticket_tree` | ticket tree has bad shape, missing ids, or duplicate ids |
| `cycle_detected` (ticket-tree) | cycle in the ticket tree itself |
| `duplicate_ticket_binding` | two tickets bind the same DOM-ID — violates spec §2.4 unique `(designVersionId, dom_id)` |
| `unknown_component_tree` | a route references a `componentTreeId` that isn't in `componentTrees` |
| `jsx_parse_error` | the JSX adapter couldn't find a root element |

### Determinism

- `assignStableDomIds(d)` is referentially transparent on `d`. Same input → byte-identical output.
- `buildDomIdMap` emits entries in depth-first pre-order across trees sorted by id.
- `diff` sorts `added` / `removed` / `modified` by `domId` and the `reasons[]` array by a canonical reason ordering.
- The JSX parser uses an in-memory ts-morph Project and emits children in source order — same source → same `RenderableDesign`.

### Tests

```bash
pnpm --filter @chiefaia/atlas-mapper test
pnpm --filter @chiefaia/atlas-mapper typecheck
```

The suite includes:

- Determinism (same input → same output across runs and across route-order shuffles)
- Survival (style/copy/asset/token changes preserve every ID; structural changes flip IDs)
- A golden test against the real prakash-tiwari CD-ZIP fixture (21 page JSX files, 1000+ DOM-IDs)
- Full coverage of the four mapper query APIs and the diff reasons matrix

### Performance

| operation | complexity | notes |
|---|---|---|
| `assignStableDomIds` | O(n) | single AST walk |
| `buildDomIdMap` | O(n) | single AST walk |
| `ticketByDomId` | O(1) | Map lookup |
| `domIdsByTicket` | O(k log k) | k = result size |
| `nearestEnclosingTicket` | O(depth) | ancestry walk |
| `descendantTickets` | O(subtree-size) | sweep over the map's pre-order entries |
| `diff` | O(n + m) | one pass over each map |

`n` = DOM entries in one design (~600 for prakash-tiwari home; ~5k for large SaaS).
