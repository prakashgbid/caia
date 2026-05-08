/**
 * @chiefaia/vastu — pipeline orchestrator.
 *
 * Public entry: `runVastuPipeline({ inputText, config, ... })`.
 * Composes Stages A → B → C left-to-right.
 *
 * Phase 2 (T4.8): Stage A is now real (LLM-routed text→FormalDoc with
 * heuristic regex pre-pass). Stages B and C remain Phase-1 stubs until
 * Phases 3 and 4 land. The orchestrator + contract are stable; downstream
 * consumers can wire against this API today and pick up the real
 * behaviour as later phases land.
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
