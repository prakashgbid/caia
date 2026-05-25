/**
 * `@caia/design-ingest-adapter-cd-zip` — public surface.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §2.1.
 *
 * Status: SCAFFOLD-ONLY. The `CdZipAdapter` class implements the
 * `DesignAdapter` contract but every method throws
 * `NotImplementedError`. The full 7-stage pipeline ships in a
 * follow-up.
 *
 * What's wired:
 *   - `sourceName = 'cd-zip'`
 *   - `capabilities` matches the spec ({supportsRefresh: false, ...})
 *   - `refresh()` throws `RefreshNotSupported` (terminal — won't be
 *     replaced when the full impl lands)
 *   - `validate()` + `parse()` throw `NotImplementedError`
 *
 * Why ship as scaffold first:
 *   - lets the framework PR pin the package boundary + workspace
 *     wiring under CI
 *   - the golden-fixture acceptance run (§9.2) needs the prakash-
 *     tiwari fixture to be assembled into a `RenderableDesign` shape
 *     that another engineer can iterate against without re-resolving
 *     the package wiring every time
 */

export { CdZipAdapter } from './adapter.js';
export type { CdZipAdapterDeps } from './adapter.js';
export { IGNORE_FILES, REQUIRED_FILES } from './constants.js';
