/**
 * @chiefaia/vastu — pipeline orchestrator.
 *
 * Public entry: `runVastuPipeline({ inputText, config, ... })`.
 * Composes Stages A → B → C left-to-right.
 *
 * Phase 3 (T4.8): Stages A and B are now real:
 *  - Stage A: LLM-routed text→FormalDoc with heuristic regex pre-pass (Phase 2)
 *  - Stage B: FormalDoc → FigmaSpec with component mapping + layout + MCP gate (Phase 3)
 * Stage C remains a Phase-1 stub until Phase 4 lands. The contract is stable;
 * downstream consumers can wire against this API today.
 */

import { textToDoc, type RouteFn } from './text-to-doc.js';
import { docToFigma } from './doc-to-figma.js';
import { figmaToScaffold } from './figma-to-scaffold.js';
import type { VastuInput, VastuResult } from './types.js';
import type { VastuConfig } from './config.js';

export interface RunVastuPipelineOptions extends VastuInput {
  config: VastuConfig;
  /**
   * Test seam — injected directly into Stage A. Defaults to the production
   * router from @chiefaia/local-llm-router.
   */
  routeFn?: RouteFn;
}

export async function runVastuPipeline(opts: RunVastuPipelineOptions): Promise<VastuResult> {
  const { inputText, formalDoc: providedDoc, pageId, config, routeFn } = opts;

  const formalDoc =
    providedDoc ??
    (await textToDoc({
      inputText,
      config,
      ...(pageId ? { pageId } : {}),
      ...(routeFn ? { routeFn } : {})
    }));
  const figmaSpec = await docToFigma({ formalDoc, config });
  const scaffold = await figmaToScaffold({ figmaSpec, config });

  return { formalDoc, figmaSpec, scaffold };
}
