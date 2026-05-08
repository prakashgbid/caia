/**
 * @chiefaia/vastu — pipeline orchestrator.
 *
 * Public entry: `runVastuPipeline({ inputText, config, ... })`.
 * Composes Stages A → B → C left-to-right. Phase 1 stages are stubs but the
 * orchestrator + contract is real; downstream consumers can wire against this
 * API today and pick up the real behaviour as later phases land.
 */

import { textToDoc } from './text-to-doc.js';
import { docToFigma } from './doc-to-figma.js';
import { figmaToScaffold } from './figma-to-scaffold.js';
import type { VastuInput, VastuResult } from './types.js';
import type { VastuConfig } from './config.js';

export interface RunVastuPipelineOptions extends VastuInput {
  config: VastuConfig;
}

export async function runVastuPipeline(opts: RunVastuPipelineOptions): Promise<VastuResult> {
  const { inputText, formalDoc: providedDoc, pageId, config } = opts;

  const formalDoc = providedDoc ?? (await textToDoc({ inputText, config, ...(pageId ? { pageId } : {}) }));
  const figmaSpec = await docToFigma({ formalDoc, config });
  const scaffold = await figmaToScaffold({ figmaSpec, config });

  return { formalDoc, figmaSpec, scaffold };
}
