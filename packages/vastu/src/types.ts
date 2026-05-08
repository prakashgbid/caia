/**
 * @chiefaia/vastu — public type contracts for the text → design → scaffold pipeline.
 *
 * The pipeline has three stages, each with a typed input and output:
 *
 *   inputText (free-form prose)
 *      ↓ Stage A — text-to-doc
 *   FormalDoc (structured page brief)
 *      ↓ Stage B — doc-to-figma  (port of Stolution VASTU)
 *   FigmaSpec (FigmaPagePayload-shaped)
 *      ↓ Stage C — figma-to-scaffold
 *   Scaffold (Next.js page.tsx + page.config.ts file set)
 *
 * Phase 1 ships these types + stage stubs. Subsequent phases fill in each
 * stage. The shape is preserved so downstream consumers can wire against
 * the contract today.
 */

/* ───────────────── Stage A — FormalDoc ───────────────── */

export interface FormalDocSection {
  /** Stable id used downstream (kebab-case). */
  id: string;
  /** Section component name (matches the brand component library). */
  section: string;
  /** Plain-language intent for the section. */
  intent: string;
  /** Optional desktop pixel height; defaults applied in Stage B. */
  height?: number;
  /** Free-form props the LLM extracted from the brief. */
  props?: Record<string, unknown>;
}

export interface FormalDoc {
  /** Stable page id. */
  id: string;
  /** Display name for the page. */
  name: string;
  /** One-line audience descriptor (used by downstream LLM steps). */
  audience: string;
  /** Brand voice override — defaults to config.brandVoice if omitted. */
  brandVoice?: string;
  /** Ordered section list. */
  sections: FormalDocSection[];
  /** Provenance: how this doc was built (heuristic, llm, hybrid, hand-authored). */
  origin: 'heuristic' | 'llm' | 'hybrid' | 'hand-authored' | 'stub';
}

/* ───────────────── Stage B — FigmaSpec ───────────────── */
/* Mirrors Stolution's FigmaPagePayload so Phase 3 can lift the implementation. */

export interface LibraryUrls {
  /** L2 — basic component library Figma URL. */
  basic: string;
  /** L3 — section / business component library Figma URL. */
  business: string;
  /** L4 — page blueprint library Figma URL (write target). */
  blueprints: string;
}

export interface ComponentRef {
  libraryKey: 'L2' | 'L3' | 'placeholder';
  nodeId?: string;
  codeConnectKey: string;
}

export interface FrameNode {
  type: 'componentInstance' | 'placeholder';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  componentRef: ComponentRef;
  props: Record<string, unknown>;
  meta: {
    sectionNumber: number;
    sectionId: string;
    cdpsDataSource?: string;
    tag?: string;
  };
}

export interface FigmaSpec {
  pageName: string;
  width: number;
  height: number;
  libraryUrls: LibraryUrls;
  frames: FrameNode[];
  meta: {
    generatedAt: string;
    pageId: string;
    schemaVersion: string;
    checksum: string;
  };
  /** Sections that had no component mapping — surfaced for UI / approval review. */
  unmappedSections: string[];
  /** Whether a Figma write was attempted (default false until Stage B implements MCP write). */
  writeStatus: 'dry-run' | 'written' | 'blocked-missing-approval' | 'blocked-checksum-drift' | 'blocked-env-gate';
  writtenFigmaUrl?: string;
}

/* ───────────────── Stage C — Scaffold ───────────────── */

export interface ScaffoldFile {
  /** Path relative to the target site root (e.g. `src/app/page.tsx`). */
  path: string;
  /** File contents. */
  contents: string;
}

export interface Scaffold {
  /** Page id this scaffold was generated for. */
  pageId: string;
  /** Files to materialise into the site repo. */
  files: ScaffoldFile[];
  /** Notes for the operator (e.g. unmapped sections that landed as placeholders). */
  notes: string[];
}

/* ───────────────── Pipeline I/O ───────────────── */

export interface VastuInput {
  /** Free-form prose describing the desired page. */
  inputText: string;
  /** Optional pre-existing formal doc to skip Stage A. */
  formalDoc?: FormalDoc;
  /** Optional override for the page id (otherwise derived). */
  pageId?: string;
}

export interface VastuResult {
  formalDoc: FormalDoc;
  figmaSpec: FigmaSpec;
  scaffold: Scaffold;
}
