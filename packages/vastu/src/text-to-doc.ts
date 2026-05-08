/**
 * Stage A — text → FormalDoc real implementation (Phase 2, T4.8).
 *
 * Pipeline:
 *   1. Heuristic regex pre-pass extracts URLs / emails / phones / addresses /
 *      industry hints / section-name keywords from the prose. Cheap +
 *      deterministic. Result is attached to FormalDoc.metadata.heuristics.
 *   2. LLM enrichment via @chiefaia/local-llm-router (Ollama-backed,
 *      zero-dollar) produces a structured FormalDoc. The heuristic hints
 *      are injected into the prompt so the LLM doesn't have to re-discover
 *      them.
 *   3. The LLM JSON output is parsed through `FormalDocSchema`. On parse
 *      failure we retry ONCE with a simpler prompt + minimal schema, then
 *      patch the heuristic + config defaults onto the result. A second
 *      parse failure throws `TextToDocLLMError` carrying both raw responses
 *      for triage.
 *
 * Production wires the real `route()` from @chiefaia/local-llm-router.
 * Tests inject `routeFn` to bypass Ollama entirely.
 */
'use strict';

import { route as defaultRoute } from '@chiefaia/local-llm-router';
import type { LLMResponse, RouterOptions } from '@chiefaia/local-llm-router';

import type { VastuConfig } from './config.js';
import { extractHeuristics, type ExtractedHints } from './heuristics.js';
import {
  FormalDocMinimalSchema,
  FormalDocSchema,
  type FormalDocMinimal
} from './formal-doc-schema.js';
import { buildFullPrompt, buildSimplifiedPrompt } from './text-to-doc-prompt.js';
import type { FormalDoc, FormalDocSection } from './types.js';

/** Function shape compatible with `@chiefaia/local-llm-router#route`. */
export type RouteFn = (
  taskType: string,
  prompt: string,
  options?: RouterOptions
) => Promise<LLMResponse>;

export interface TextToDocOptions {
  inputText: string;
  config: VastuConfig;
  pageId?: string;
  /** Test seam — defaults to the production router. */
  routeFn?: RouteFn;
  /** Override task-type used for routing. Default: 'vastu-text-to-doc'. */
  taskType?: string;
}

/**
 * Error surfaced when the LLM's structured output fails Zod validation
 * twice in a row. Carries the raw responses so the caller (or a future
 * Mentor probe) can triage the prompt.
 */
export class TextToDocLLMError extends Error {
  public readonly fullResponseRaw: string;
  public readonly retryResponseRaw: string;
  public readonly fullParseError: string;
  public readonly retryParseError: string;
  constructor(opts: {
    message: string;
    fullResponseRaw: string;
    retryResponseRaw: string;
    fullParseError: string;
    retryParseError: string;
  }) {
    super(opts.message);
    this.name = 'TextToDocLLMError';
    this.fullResponseRaw = opts.fullResponseRaw;
    this.retryResponseRaw = opts.retryResponseRaw;
    this.fullParseError = opts.fullParseError;
    this.retryParseError = opts.retryParseError;
  }
}

const DEFAULT_TASK_TYPE = 'vastu-text-to-doc';

export async function textToDoc(opts: TextToDocOptions): Promise<FormalDoc> {
  const { inputText, config, pageId: pageIdOverride } = opts;
  const trimmed = inputText?.trim() ?? '';
  if (!trimmed) {
    throw new Error('textToDoc: inputText is empty');
  }

  const pageId = pageIdOverride ?? deriveSlug(trimmed) ?? 'page';
  const hints = extractHeuristics(trimmed);

  // Tests inject a stub; production uses the real router.
  const routeFn: RouteFn = opts.routeFn ?? defaultRoute;
  const taskType = opts.taskType ?? DEFAULT_TASK_TYPE;

  // ── Attempt 1 — full prompt ────────────────────────────────────────
  const fullPrompt = buildFullPrompt({ inputText: trimmed, config, hints, pageId });
  const fullResponse = await invokeRoute(routeFn, taskType, fullPrompt);
  const fullParse = tryParseFormalDoc(fullResponse.response);

  if (fullParse.ok) {
    return finaliseDoc(fullParse.value, {
      pageId,
      hints,
      config,
      llmModel: fullResponse.model,
      provider: fullResponse.provider,
      attempt: 1
    });
  }

  // ── Attempt 2 — simplified prompt + minimal schema ─────────────────
  const simplifiedPrompt = buildSimplifiedPrompt({
    inputText: trimmed,
    config,
    hints,
    pageId
  });
  const retryResponse = await invokeRoute(routeFn, taskType, simplifiedPrompt);
  const retryParse = tryParseMinimalDoc(retryResponse.response);

  if (retryParse.ok) {
    const reconstructed = reconstructFromMinimal(retryParse.value, {
      pageId,
      trimmedInput: trimmed,
      hints,
      config
    });
    return finaliseDoc(reconstructed, {
      pageId,
      hints,
      config,
      llmModel: retryResponse.model,
      provider: retryResponse.provider,
      attempt: 2
    });
  }

  throw new TextToDocLLMError({
    message:
      'textToDoc: LLM output failed FormalDoc schema validation twice. ' +
      'See fullParseError + retryParseError for details.',
    fullResponseRaw: fullResponse.response,
    retryResponseRaw: retryResponse.response,
    fullParseError: fullParse.error,
    retryParseError: retryParse.error
  });
}

/* ─── Internals ─────────────────────────────────────────────────────── */

interface FinaliseInputs {
  pageId: string;
  hints: ExtractedHints;
  config: VastuConfig;
  llmModel: string;
  provider: string;
  attempt: 1 | 2;
}

function finaliseDoc(doc: FormalDoc, info: FinaliseInputs): FormalDoc {
  const sections = doc.sections.map((s, i) => ensureSectionShape(s, i, info.config));
  const hasHeuristicSignal =
    info.hints.urls.length > 0 ||
    info.hints.emails.length > 0 ||
    info.hints.phones.length > 0 ||
    info.hints.addresses.length > 0 ||
    info.hints.industries.length > 0 ||
    info.hints.sectionKeywords.length > 0;
  const origin: FormalDoc['origin'] = hasHeuristicSignal ? 'hybrid' : 'llm';

  const metadata: Record<string, unknown> = {
    ...(doc.metadata ?? {}),
    heuristics: info.hints,
    llm: {
      model: info.llmModel,
      provider: info.provider,
      attempt: info.attempt
    }
  };

  const merged: FormalDoc = {
    ...doc,
    id: info.pageId,
    name: doc.name && doc.name.trim() !== '' ? doc.name : humanise(info.pageId),
    audience: doc.audience && doc.audience.trim() !== '' ? doc.audience : info.config.brandVoice.audience,
    brandVoice: doc.brandVoice ?? info.config.brandVoice.tone,
    sections,
    origin,
    metadata
  };
  if (info.hints.industries[0] && !merged.industry) {
    merged.industry = info.hints.industries[0];
  }
  return merged;
}

function ensureSectionShape(
  section: FormalDocSection,
  index: number,
  config: VastuConfig
): FormalDocSection {
  const id =
    section.id && section.id.trim() !== ''
      ? section.id.trim()
      : `${slugify(section.section || `section-${index + 1}`)}-${index + 1}`;
  return {
    ...section,
    id,
    height: section.height ?? config.defaultSectionHeight
  };
}

function reconstructFromMinimal(
  minimal: FormalDocMinimal,
  ctx: { pageId: string; trimmedInput: string; hints: ExtractedHints; config: VastuConfig }
): FormalDoc {
  const sections: FormalDocSection[] = minimal.sections.map((s, i) => ({
    id: `${slugify(s.section)}-${i + 1}`,
    section: s.section,
    intent: s.intent,
    height: ctx.config.defaultSectionHeight
  }));
  return {
    id: ctx.pageId,
    name: humanise(ctx.pageId),
    audience: ctx.config.brandVoice.audience,
    brandVoice: ctx.config.brandVoice.tone,
    sections,
    origin: 'llm'
  };
}

interface ParseOk<T> {
  ok: true;
  value: T;
}
interface ParseErr {
  ok: false;
  error: string;
}

function tryParseFormalDoc(raw: string): ParseOk<FormalDoc> | ParseErr {
  const json = extractJsonObject(raw);
  if (json === null) {
    return { ok: false, error: 'no-json-object-in-response' };
  }
  const result = FormalDocSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.message.slice(0, 600) };
  }
  return { ok: true, value: result.data as FormalDoc };
}

function tryParseMinimalDoc(raw: string): ParseOk<FormalDocMinimal> | ParseErr {
  const json = extractJsonObject(raw);
  if (json === null) {
    return { ok: false, error: 'no-json-object-in-response' };
  }
  const result = FormalDocMinimalSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.message.slice(0, 600) };
  }
  return { ok: true, value: result.data };
}

/**
 * Pull the first JSON object out of a raw LLM response. Tolerates:
 *   - bare JSON
 *   - JSON wrapped in ```json fences
 *   - JSON preceded/followed by chatter
 *
 * Returns null if no balanced object is found.
 */
function extractJsonObject(raw: string): unknown {
  if (!raw) return null;
  // Strip code-fence wrappers (```json ... ``` or ``` ... ```).
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (fence?.[1]) {
    text = fence[1].trim();
  }
  // Find the first balanced top-level { ... } block.
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function invokeRoute(
  routeFn: RouteFn,
  taskType: string,
  prompt: string
): Promise<LLMResponse> {
  // Zero-dollar gate: force local. The router falls back to the Claude
  // binary by default for many task types; we want pure Ollama here.
  return routeFn(taskType, prompt, { forceLocal: true, fallbackOnError: false });
}

function deriveSlug(text: string): string | null {
  const slug = slugify(text.split(/[.\n!?]/, 1)[0]?.slice(0, 60) ?? '');
  return slug || null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function humanise(slug: string): string {
  if (!slug) return 'Page';
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
