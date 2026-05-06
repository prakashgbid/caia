/**
 * Public entry point: generateCaiaPrimer().
 *
 * Per Option E shape (standing rule 2026-05-06), every CAIA-specific
 * path is a constructor parameter with a CAIA default. Tests inject
 * fixture corpora; production injects the CAIA defaults.
 *
 * Behaviour:
 *
 *   1. Read each source file via the (injectable) FsReader.
 *   2. Extract: standing instructions (alphabetised), architecture TOC,
 *      DoD stages.
 *   3. Render the primer markdown.
 *   4. Estimate tokens; trim deterministically if over budget AND
 *      summariseOnOverflow is true; otherwise throw on overflow.
 *   5. Return PrimerResult { text, estimatedTokens, sections, trimmed }.
 *
 * The function is deterministic: same inputs ⇒ byte-identical output.
 */

import {
  DEFAULT_ARCHITECTURE_DOC_PATH,
  DEFAULT_DOD_SOURCE_PATH,
  DEFAULT_MEMORY_INDEX_PATH,
  DEFAULT_TOKEN_BUDGET
} from './defaults.js';
import {
  extractArchitectureToc,
  extractDoDStages,
  extractStandingInstructions
} from './extract.js';
import { renderPrimer } from './render.js';
import { estimateTokens } from './token-estimate.js';
import { trimToBudget } from './trim.js';
import {
  defaultFsReader,
  type FsReader,
  type GenerateCaiaPrimerOptions,
  type PrimerResult
} from './types.js';

/**
 * Internal options shape — same as the public one but with explicit
 * injected FsReader for testability. Production callers don't pass an
 * fsReader; the default uses node:fs.
 */
export interface InternalOptions extends GenerateCaiaPrimerOptions {
  fsReader?: FsReader;
}

/**
 * Generate the CAIA primer. See module docstring for behaviour.
 *
 * @param opts — all parameters optional; CAIA defaults apply when
 *               omitted. Tests pass in a custom fsReader + fixture
 *               paths.
 */
export function generateCaiaPrimer(opts: InternalOptions = {}): PrimerResult {
  const fsReader = opts.fsReader ?? defaultFsReader;
  const memoryIndexPath = opts.memoryIndexPath ?? DEFAULT_MEMORY_INDEX_PATH;
  const architectureDocPath =
    opts.architectureDocPath ?? DEFAULT_ARCHITECTURE_DOC_PATH;
  const dodSourcePath = opts.dodSourcePath ?? DEFAULT_DOD_SOURCE_PATH;
  const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const summariseOnOverflow = opts.summariseOnOverflow ?? false;

  for (const p of [memoryIndexPath, architectureDocPath, dodSourcePath]) {
    if (!fsReader.exists(p)) {
      throw new Error(
        `generateCaiaPrimer: required source file not found: ${p}`
      );
    }
  }

  const memoryMd = fsReader.readFile(memoryIndexPath);
  const architectureMd = fsReader.readFile(architectureDocPath);
  const sequencingMd = fsReader.readFile(dodSourcePath);

  const standingInstructions = extractStandingInstructions(memoryMd);
  const architectureToc = extractArchitectureToc(architectureMd);
  const dodStages = extractDoDStages(sequencingMd);

  const fullText = renderPrimer({
    standingInstructions,
    architectureToc,
    dodStages
  });
  const fullTokens = estimateTokens(fullText);

  if (fullTokens <= tokenBudget) {
    return {
      text: fullText,
      estimatedTokens: fullTokens,
      sections: ['standing-instructions', 'architecture-toc', 'dod-checklist'],
      trimmed: false
    };
  }

  if (!summariseOnOverflow) {
    throw new Error(
      `generateCaiaPrimer: primer estimates at ${fullTokens} tokens, over ` +
        `budget ${tokenBudget}. Pass summariseOnOverflow:true to trim, or ` +
        `edit the source files (MEMORY.md is the largest contributor).`
    );
  }

  const trimResult = trimToBudget({
    standingInstructions,
    architectureToc,
    dodStages,
    tokenBudget
  });

  return {
    text: trimResult.text,
    estimatedTokens: trimResult.estimatedTokens,
    sections: ['standing-instructions', 'architecture-toc', 'dod-checklist'],
    trimmed: trimResult.trimmed
  };
}
