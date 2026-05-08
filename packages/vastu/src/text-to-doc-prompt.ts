/**
 * @chiefaia/vastu — Stage A prompt templates.
 *
 * Two prompts:
 *   - buildFullPrompt: first attempt. Asks the LLM for the full FormalDoc
 *     shape with all the optional metadata (industry, primaryCtas, brandVoice).
 *   - buildSimplifiedPrompt: retry attempt. Only asks for the structural
 *     minimum (`sections: [{section, intent}]`). The orchestrator fills in
 *     the rest from heuristic hints + config defaults.
 *
 * Both are deterministic strings — no LLM-side templating, no random
 * sampling. The prompts intentionally over-explain the JSON contract
 * because Ollama-served local models occasionally lapse into prose.
 */
'use strict';

import type { ExtractedHints } from './heuristics.js';
import type { VastuConfig } from './config.js';

export interface PromptInputs {
  inputText: string;
  config: VastuConfig;
  hints: ExtractedHints;
  pageId: string;
}

const FULL_SCHEMA_DESC = `JSON schema (TypeScript):
{
  "id": string,
  "name": string,
  "audience": string,
  "brandVoice"?: string,
  "industry"?: string,
  "primaryCtas"?: string[],
  "sections": Array<{
    "id": string,        // kebab-case, unique within the page
    "section": string,   // canonical PascalCase component name (e.g. "HeroSection")
    "intent": string,    // 1-3 sentences describing what the section does
    "height"?: number,   // desktop pixel height; OMIT to use the default
    "props"?: object     // free-form props (copy strings, links, etc.)
  }>,
  "origin": "llm",       // always "llm" — this is the Stage-A LLM output
  "metadata"?: object
}`;

export function buildFullPrompt({ inputText, config, hints, pageId }: PromptInputs): string {
  const hintsBlock = renderHintsBlock(hints);
  const knownSections =
    Object.keys(config.componentLibrary).length > 0
      ? `Known component-library section names (prefer these when applicable):\n  ${Object.keys(
          config.componentLibrary
        )
          .sort()
          .join(', ')}`
      : 'No pre-registered component library — pick descriptive PascalCase section names yourself (HeroSection, FeatureGrid, PricingTable, etc.).';

  return [
    'You are a website-architecture analyst. Convert the user prose into a strict JSON FormalDoc.',
    '',
    'Rules:',
    `  • Output ONLY valid JSON. No prose, no markdown fences, no commentary.`,
    `  • Use the page id "${pageId}" verbatim as the "id" field.`,
    `  • "audience" defaults to "${config.brandVoice.audience}" if the prose doesn't specify one.`,
    `  • "brandVoice" defaults to "${config.brandVoice.tone}" unless the prose contradicts it.`,
    `  • Every section needs a kebab-case "id", a PascalCase "section" component name, and a 1-3 sentence "intent".`,
    `  • Set "origin" to "llm".`,
    `  • If you can identify them, populate "industry" with a short slug (e.g. "legal", "saas") and "primaryCtas" with the 1-3 user actions the page is steering toward.`,
    '',
    knownSections,
    '',
    FULL_SCHEMA_DESC,
    '',
    hintsBlock,
    '',
    'User prose (verbatim):',
    '"""',
    inputText.trim(),
    '"""',
    '',
    'Respond with the JSON only.'
  ].join('\n');
}

export function buildSimplifiedPrompt({ inputText, hints }: PromptInputs): string {
  const hintsLine =
    hints.sectionKeywords.length > 0
      ? `Section keywords detected: ${hints.sectionKeywords.join(', ')}.`
      : '';
  return [
    'Output ONLY valid JSON. No prose. No markdown fences.',
    '',
    'Schema:',
    '  {"sections": [{"section": "PascalCaseComponentName", "intent": "1-3 sentences"}]}',
    '',
    'Each section MUST have a non-empty "section" and a non-empty "intent".',
    'Produce at least one section. Prefer 3-6 sections for typical landing pages.',
    hintsLine,
    '',
    'User prose:',
    '"""',
    inputText.trim(),
    '"""',
    '',
    'JSON only.'
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function renderHintsBlock(hints: ExtractedHints): string {
  const parts: string[] = ['Heuristic hints already extracted from the prose (use these verbatim — do not re-invent):'];
  if (hints.urls.length > 0) parts.push(`  • urls: ${truncateList(hints.urls)}`);
  if (hints.emails.length > 0) parts.push(`  • emails: ${truncateList(hints.emails)}`);
  if (hints.phones.length > 0) parts.push(`  • phones: ${truncateList(hints.phones)}`);
  if (hints.addresses.length > 0) parts.push(`  • addresses: ${truncateList(hints.addresses)}`);
  if (hints.industries.length > 0) parts.push(`  • inferred industry: ${hints.industries.join(', ')}`);
  if (hints.sectionKeywords.length > 0)
    parts.push(`  • section-name hints: ${hints.sectionKeywords.join(', ')}`);
  if (parts.length === 1) {
    parts.push('  (none — work from the prose alone)');
  }
  return parts.join('\n');
}

function truncateList(xs: string[]): string {
  const max = 6;
  if (xs.length <= max) return xs.join(', ');
  return `${xs.slice(0, max).join(', ')}, … (${xs.length - max} more)`;
}
