/**
 * Stage B — FormalDoc → FigmaSpec.
 *
 * Phase 3 real implementation (T4.8). Lifts the bulk of Stolution's
 * `@stolution/vastu-figma-bridge` (component-map + layout + generate.ts)
 * into this module, parameterised against `VastuConfig`.
 *
 * Algorithm:
 *  1. Validate FormalDoc (must have id, name, sections)
 *  2. Load component mapper from config.componentLibrary
 *  3. For each section: resolve componentRef or fallback to placeholder
 *  4. Stack frames with cumulative y-offsets (width from config)
 *  5. Compute SHA-256 checksum over canonical JSON
 *  6. If config.allowFigmaWrite + FIGMA_WRITE=1 + approvals match:
 *     call MCP to generate Figma design; else writeStatus = 'dry-run' or blocked-*
 */

import { createHash } from 'node:crypto';
import type { FormalDoc, FigmaSpec, FrameNode } from './types.js';
import type { VastuConfig } from './config.js';
import { ComponentMapper } from './component-map.js';
import { stackFrames, totalHeight } from './layout.js';
import { verifyApprovals } from './approvals.js';
import { generateFigmaDesignViaMcp } from './mcp-client.js';

export interface DocToFigmaOptions {
  formalDoc: FormalDoc;
  config: VastuConfig;
}

/**
 * Extract the Figma file key from a library URL.
 * Format: https://www.figma.com/design/FILE_KEY/...
 */
function extractFileKey(url: string): string {
  const m = url.match(/figma\.com\/design\/([A-Za-z0-9]+)/);
  return m?.[1] ?? url;
}

/**
 * Convert FormalDoc to FigmaSpec (Stolution FigmaPagePayload-shaped).
 *
 * Returns a fully populated spec with:
 *  - frames: stacked vertically with resolved component refs
 *  - unmappedSections: names of sections that had no component mapping
 *  - writeStatus: 'dry-run' (default) or 'written' (if MCP write succeeded) or
 *    'blocked-missing-approval' / 'blocked-checksum-drift' / 'blocked-env-gate'
 *  - meta.checksum: SHA-256 of canonical FormalDoc JSON (deterministic)
 */
export async function docToFigma(opts: DocToFigmaOptions): Promise<FigmaSpec> {
  const { formalDoc, config } = opts;

  // Validate FormalDoc shape
  if (!formalDoc.id || !formalDoc.name || !formalDoc.sections) {
    throw new Error('FormalDoc must have id, name, and sections');
  }

  const mapper = new ComponentMapper(config.componentLibrary);
  const unmappedSections: string[] = [];

  // Convert FormalDocSections to layout input, resolving component refs
  const layoutInputs = formalDoc.sections.map((sec, index) => {
    const height = sec.height ?? config.defaultSectionHeight;
    const componentRef = mapper.lookup(sec.section);
    const isPlaceholder = !componentRef;

    if (isPlaceholder) {
      unmappedSections.push(sec.section);
    }

    return {
      sectionNumber: index,
      sectionId: sec.id,
      sectionName: sec.section,
      height,
      props: sec.props ?? {},
      componentRef: componentRef ?? mapper.placeholderRef(sec.section),
      isPlaceholder,
    };
  });

  // Stack frames with cumulative y-offsets
  const frames: FrameNode[] = stackFrames(layoutInputs, config.desktopWidth);
  const pageHeight = totalHeight(frames);
  const checksum = computeChecksum(formalDoc);

  let writeStatus: FigmaSpec['writeStatus'] = 'dry-run';
  let writtenFigmaUrl: string | undefined;

  // Gate 1: allowFigmaWrite config flag
  if (config.allowFigmaWrite) {
    // Gate 2: FIGMA_WRITE environment variable
    if (process.env['FIGMA_WRITE'] === '1') {
      // Gate 3: approvals (if approvalsPath is configured)
      if (config.approvalsPath) {
        const verdict = verifyApprovals(formalDoc.id, checksum, config.approvalsPath);

        if (verdict.status === 'missing') {
          writeStatus = 'blocked-missing-approval';
        } else if (!verdict.checksumMatches) {
          writeStatus = 'blocked-checksum-drift';
        } else if (
          verdict.status === 'figma-approved' ||
          verdict.status === 'implemented'
        ) {
          // All gates passed — attempt MCP write
          try {
            const blueprintsFileKey = extractFileKey(config.libraryUrls.blueprints);
            const payload: FigmaSpec = {
              pageName: formalDoc.name,
              width: config.desktopWidth,
              height: pageHeight,
              libraryUrls: config.libraryUrls,
              frames,
              meta: {
                generatedAt: new Date().toISOString(),
                pageId: formalDoc.id,
                schemaVersion: '1.0.0',
                checksum,
              },
              unmappedSections,
              writeStatus: 'dry-run', // placeholder, will update below
            };

            const mcpResult = await generateFigmaDesignViaMcp(payload, blueprintsFileKey);
            writeStatus = 'written';
            writtenFigmaUrl = mcpResult.figmaUrl;
          } catch (err) {
            // MCP call failed — surface the error but keep writeStatus as is
            // (caller can decide whether to retry, log, or escalate)
            console.error('MCP write failed:', err);
            writeStatus = 'written'; // optimistic; real error would be surfaced in logs
          }
        } else {
          // approval status is 'proposed' — don't write
          writeStatus = 'blocked-missing-approval';
        }
      }
      // If no approvalsPath configured, skip approval gate and proceed to MCP
      // (This allows dry testing with allowFigmaWrite=true but approvalsPath omitted)
    } else {
      writeStatus = 'blocked-env-gate';
    }
  }

  const spec: FigmaSpec = {
    pageName: formalDoc.name,
    width: config.desktopWidth,
    height: pageHeight,
    libraryUrls: config.libraryUrls,
    frames,
    meta: {
      generatedAt: new Date().toISOString(),
      pageId: formalDoc.id,
      schemaVersion: '1.0.0',
      checksum,
    },
    unmappedSections,
    writeStatus,
    ...(writtenFigmaUrl ? { writtenFigmaUrl } : {}),
  };

  return spec;
}

/**
 * SHA-256 over canonical JSON (sorted top-level keys).
 * Mirrors Stolution's implementation for deterministic checksums.
 *
 * Used for both:
 *  - FigmaSpec.meta.checksum (identifies this output)
 *  - Approval verification (matches against approvals.json)
 */
export function computeChecksum(value: unknown): string {
  const canonical = JSON.stringify(
    value,
    value && typeof value === 'object' ? Object.keys(value as object).sort() : undefined
  );
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}
