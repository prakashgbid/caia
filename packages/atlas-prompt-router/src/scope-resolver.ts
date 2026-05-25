/**
 * Scope-resolver — picks `self-only | subtree | page` for each prompt.
 */

import type {
  IntentClassifier,
  IntentClassifierInput,
  ScopeClassification,
  ScopeKind,
} from './types.js';

export type LlmInvoker = (input: {
  readonly system: string;
  readonly user: string;
  readonly model: string;
  readonly maxTokens: number;
}) => Promise<string>;

const SECTION_LEVEL_HINTS = [
  'rebuild', 'redesign', 'restructure', 'reorganise', 'reorganize',
  'whole section', 'entire section', 'full redesign', 'overhaul',
  'replace this section', 'replace the section',
];

const PAGE_LEVEL_HINTS = [
  'move the', 'move this', 'rearrange the page', 'reorder the page',
  'change the layout', 'page layout', 'whole page', 'entire page',
  'across the page',
];

const SELF_ONLY_HINTS = [
  'serif', 'sans-serif', 'bigger', 'smaller', 'colour', 'color',
  'font', 'typography', 'spacing', 'padding', 'margin', 'rename',
  'rewrite the copy', 'change the copy',
];

interface HeuristicOptions {
  readonly sectionHints?: ReadonlyArray<string>;
  readonly pageHints?: ReadonlyArray<string>;
  readonly selfHints?: ReadonlyArray<string>;
}

export function makeHeuristicClassifier(opts: HeuristicOptions = {}): IntentClassifier {
  const pageHints = (opts.pageHints ?? PAGE_LEVEL_HINTS).map((h) => h.toLowerCase());
  const sectionHints = (opts.sectionHints ?? SECTION_LEVEL_HINTS).map((h) => h.toLowerCase());
  const selfHints = (opts.selfHints ?? SELF_ONLY_HINTS).map((h) => h.toLowerCase());

  return (input: IntentClassifierInput): ScopeClassification => {
    const text = input.prompt.toLowerCase();
    for (const hint of pageHints) {
      if (text.includes(hint)) return { kind: 'page', reason: `keyword: "${hint}"` };
    }
    for (const hint of sectionHints) {
      if (text.includes(hint)) return { kind: 'subtree', reason: `keyword: "${hint}"` };
    }
    for (const hint of selfHints) {
      if (text.includes(hint)) return { kind: 'self-only', reason: `keyword: "${hint}"` };
    }
    return { kind: 'self-only', reason: 'no broader-scope keyword detected' };
  };
}

const CLAUDE_SYSTEM_PROMPT = [
  'You classify the SCOPE OF CHANGE for a UI change request on a',
  'specific ticket in a hierarchical site decomposition. Respond with',
  'ONE JSON object on a single line: {"scope":"self-only"|"subtree"|',
  '"page","reason":"<1-sentence>"}.',
  '',
  'Definitions:',
  '- self-only: change affects only the selected ticket (style, copy, asset).',
  '- subtree:   change affects the ticket plus every descendant.',
  '- page:      change affects layout across the page (move, reorder).',
  '',
  'Output strictly the JSON object — no preamble, no markdown fence.',
].join('\n');

function buildUserPrompt(input: IntentClassifierInput): string {
  return [
    `Ticket id: ${input.ticket.id}`,
    `Ticket dom id: ${input.ticket.domId ?? '(none)'}`,
    `Multi-select size: ${input.selection.length}`,
    `Prompt:`,
    input.prompt,
  ].join('\n');
}

const SCOPE_KINDS: ReadonlySet<ScopeKind> = new Set<ScopeKind>(['self-only', 'subtree', 'page']);

export function parseScopeClassification(
  raw: string,
  fallback: ScopeClassification = {
    kind: 'self-only',
    reason: 'classifier output unparseable; defaulted to self-only',
  },
): ScopeClassification {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) return fallback;
  const candidate = trimmed.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fallback;
  }
  const obj = parsed as Record<string, unknown>;
  const scope = obj['scope'];
  const reason = obj['reason'];
  if (typeof scope !== 'string' || !SCOPE_KINDS.has(scope as ScopeKind)) return fallback;
  const finalReason =
    typeof reason === 'string' && reason.length > 0 ? reason : 'classifier returned no reason';
  return { kind: scope as ScopeKind, reason: finalReason };
}

interface ClaudeClassifierOptions {
  readonly invoke: LlmInvoker;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly fallback?: ScopeClassification;
}

export function makeClaudeIntentClassifier(opts: ClaudeClassifierOptions): IntentClassifier {
  const model = opts.model ?? 'claude-haiku-4-5-20251001';
  const maxTokens = opts.maxTokens ?? 256;
  const fallback = opts.fallback ?? {
    kind: 'self-only',
    reason: 'classifier output unparseable; defaulted to self-only',
  };

  return async (input: IntentClassifierInput): Promise<ScopeClassification> => {
    const raw = await opts.invoke({
      system: CLAUDE_SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      model,
      maxTokens,
    });
    return parseScopeClassification(raw, fallback);
  };
}

export function makeClaudeExpectedChangeWriter(opts: {
  readonly invoke: LlmInvoker;
  readonly model?: string;
  readonly maxTokens?: number;
}): (input: {
  readonly prompt: string;
  readonly ticket: { readonly id: string; readonly domId?: string };
  readonly scope: ScopeKind;
}) => Promise<string> {
  const model = opts.model ?? 'claude-haiku-4-5-20251001';
  const maxTokens = opts.maxTokens ?? 512;
  const system = [
    'You produce a SINGLE PARAGRAPH (≤ 60 words) describing the',
    'expected change for a UI ticket, grounded in the operator prompt.',
    'No preamble, no markdown, no quotes. Plain text. Speak in the',
    'imperative ("Change…", "Reduce…", "Replace…").',
  ].join('\n');
  return async (input) => {
    const user = [
      `Ticket: ${input.ticket.id}`,
      `Scope: ${input.scope}`,
      `Operator prompt: ${input.prompt}`,
    ].join('\n');
    const raw = await opts.invoke({ system, user, model, maxTokens });
    return raw.trim();
  };
}

export function makeNoopExpectedChangeWriter(
  prefix: string = 'Change',
): (input: {
  readonly prompt: string;
  readonly ticket: { readonly id: string; readonly domId?: string };
  readonly scope: ScopeKind;
}) => string {
  return (input): string => `${prefix} ${input.ticket.id} — ${input.prompt}`.trim();
}
