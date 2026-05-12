// Intent classifier v2 — cascade-aware router with an externalized taxonomy.
//
// Differences from v1 (src/classifier.ts):
//   1. Taxonomy + per-intent thresholds live in `config/routing-rules.yaml`
//      (loaded once at module init via a minimal hand-rolled YAML parser
//      so we don't pull in js-yaml as a new dependency).
//   2. A cheap keyword pre-pass short-circuits the LLM call when the spec
//      contains keywords for exactly one intent.
//   3. The result includes `next_tier` (the next tier on the cascade ladder)
//      and `needs_cascade` (true when reported confidence is below the
//      recommended tier's `min_confidence`). The cascade controller can
//      use these directly without re-deriving from the v1 fields.
//
// v1 (`classify()` / `IntentResult`) is left untouched — see classifier.ts.
// This file is additive.
//
// Phase 4 of the Local-AI-First build chain (LAI-classifier-v2).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  INTENT_VALUES,
  TIER_VALUES,
  type Intent,
  type RecommendedTier,
} from './classifier.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface IntentRule {
  name: Intent;
  default_tier: RecommendedTier;
  min_confidence: number;
  keywords: string[];
}

export interface RoutingRules {
  version: number;
  default_confidence_threshold: number;
  escalation_threshold: number;
  cascade_thresholds: Record<string, number>;
  tier_order: RecommendedTier[];
  intents: IntentRule[];
}

export interface IntentResultV2 {
  intent: Intent;
  confidence: number;
  needs_escalation: boolean;
  recommended_tier: RecommendedTier;
  next_tier: RecommendedTier | null;
  needs_cascade: boolean;
  reasoning: string;
  source: 'keyword-prepass' | 'llm' | 'abstain';
  rules_version: number;
}

export interface ClassifyV2Options {
  model?: string;
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  /** Override the rules document (mainly for tests). */
  rules?: RoutingRules;
  /** Skip the cheap keyword prepass — force LLM classification. */
  skipKeywordPrepass?: boolean;
}

// ─── YAML loader (minimal, scoped to routing-rules.yaml shape) ──────────
//
// Handles:
//   - `# comments` and blank lines
//   - `key: value` scalars (string/number/bool)
//   - `key:` headers followed by indented children
//   - `- value` list items (scalar or block-map)
//   - 2-space indentation
//
// Does NOT handle anchors, flow style ({a:b}/[a,b]), or multi-line scalars.
// The routing-rules.yaml schema is intentionally pinned to this subset.

type YamlNode = string | number | boolean | YamlNode[] | { [k: string]: YamlNode };

function parseScalar(s: string): YamlNode {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~' || t === '') return '';
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  // Quoted string
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  // Inline list `[a, b, c]` (used for `keywords: []` and short keyword arrays)
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map(item => parseScalar(item.trim()));
  }
  return t;
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

interface ParsedLine {
  indent: number;
  raw: string;          // line with leading spaces stripped
  isListItem: boolean;  // starts with `- `
}

function preprocess(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    // Strip trailing comments (only if `#` isn't inside a quoted string —
    // our schema doesn't use `#` in values so naive stripping is safe).
    let cleaned = line;
    const hashIdx = cleaned.indexOf('#');
    if (hashIdx >= 0) {
      // Allow `#` only if preceded by something other than whitespace at line start
      const before = cleaned.slice(0, hashIdx);
      if (before.trim() === '' || /\s$/.test(before)) {
        cleaned = before;
      }
    }
    if (cleaned.trim() === '') continue;
    const indent = indentOf(cleaned);
    const raw = cleaned.slice(indent);
    const isListItem = raw.startsWith('- ');
    out.push({ indent, raw, isListItem });
  }
  return out;
}

function parseBlock(
  lines: ParsedLine[],
  startIdx: number,
  parentIndent: number,
): { value: YamlNode; nextIdx: number } {
  if (startIdx >= lines.length) return { value: '', nextIdx: startIdx };
  const first = lines[startIdx];
  if (first === undefined) return { value: '', nextIdx: startIdx };

  if (first.isListItem) {
    const list: YamlNode[] = [];
    let i = startIdx;
    while (i < lines.length) {
      const ln = lines[i];
      if (ln === undefined) break;
      if (ln.indent < first.indent) break;
      if (ln.indent === first.indent && ln.isListItem) {
        const itemBody = ln.raw.slice(2);
        if (itemBody.includes(':') && !itemBody.startsWith('"') && !itemBody.startsWith("'")) {
          // Block-map item: the `- ` introduces a map whose first key is on this line.
          const colonIdx = itemBody.indexOf(':');
          const key = itemBody.slice(0, colonIdx).trim();
          const rest = itemBody.slice(colonIdx + 1).trim();
          const map: Record<string, YamlNode> = {};
          if (rest !== '') {
            map[key] = parseScalar(rest);
          } else {
            // Nested block whose indent is item.indent + 2 (relative to `- `)
            const nested = parseBlock(lines, i + 1, ln.indent + 2);
            map[key] = nested.value;
            i = nested.nextIdx - 1;
          }
          // Continue consuming sibling keys of the same map (deeper indent than `- `).
          i++;
          while (i < lines.length) {
            const nxt = lines[i];
            if (nxt === undefined) break;
            if (nxt.indent <= ln.indent) break;
            if (nxt.isListItem) break;
            const colon2 = nxt.raw.indexOf(':');
            if (colon2 < 0) break;
            const k2 = nxt.raw.slice(0, colon2).trim();
            const r2 = nxt.raw.slice(colon2 + 1).trim();
            if (r2 !== '') {
              map[k2] = parseScalar(r2);
              i++;
            } else {
              const sub = parseBlock(lines, i + 1, nxt.indent + 2);
              map[k2] = sub.value;
              i = sub.nextIdx;
            }
          }
          list.push(map);
          continue;
        }
        // Scalar list item.
        list.push(parseScalar(itemBody));
        i++;
        continue;
      }
      break;
    }
    return { value: list, nextIdx: i };
  }

  // Block map
  const map: Record<string, YamlNode> = {};
  let i = startIdx;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln === undefined) break;
    if (ln.indent < parentIndent) break;
    if (ln.indent !== first.indent) break;
    if (ln.isListItem) break;
    const colon = ln.raw.indexOf(':');
    if (colon < 0) { i++; continue; }
    const key = ln.raw.slice(0, colon).trim();
    const rest = ln.raw.slice(colon + 1).trim();
    if (rest !== '') {
      map[key] = parseScalar(rest);
      i++;
    } else {
      const sub = parseBlock(lines, i + 1, ln.indent + 2);
      map[key] = sub.value;
      i = sub.nextIdx;
    }
  }
  return { value: map, nextIdx: i };
}

/** Parse the routing-rules.yaml subset. Exported for tests. */
export function parseRoutingRulesYaml(text: string): RoutingRules {
  const lines = preprocess(text);
  const parsed = parseBlock(lines, 0, 0).value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('routing-rules.yaml: top level must be a map');
  }
  const root = parsed as Record<string, YamlNode>;

  const version = numberAt(root, 'version', 2);
  const default_confidence_threshold = numberAt(root, 'default_confidence_threshold', 0.6);
  const escalation_threshold = numberAt(root, 'escalation_threshold', 0.5);

  const ct = root['cascade_thresholds'];
  const cascade_thresholds: Record<string, number> = {};
  if (typeof ct === 'object' && ct !== null && !Array.isArray(ct)) {
    for (const [k, v] of Object.entries(ct)) {
      if (typeof v === 'number') cascade_thresholds[k] = v;
    }
  }

  const tierRaw = root['tier_order'];
  const tier_order: RecommendedTier[] = Array.isArray(tierRaw)
    ? tierRaw.filter((t): t is RecommendedTier =>
        typeof t === 'string' && (TIER_VALUES as readonly string[]).includes(t))
    : [];

  const intentsRaw = root['intents'];
  const intents: IntentRule[] = [];
  if (Array.isArray(intentsRaw)) {
    for (const item of intentsRaw) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const m = item as Record<string, YamlNode>;
      const name = m['name'];
      if (typeof name !== 'string' || !(INTENT_VALUES as readonly string[]).includes(name)) continue;
      const default_tier = m['default_tier'];
      if (typeof default_tier !== 'string' || !(TIER_VALUES as readonly string[]).includes(default_tier)) continue;
      const min_confidence = typeof m['min_confidence'] === 'number' ? m['min_confidence'] as number : 0.6;
      const kwRaw = m['keywords'];
      const keywords = Array.isArray(kwRaw)
        ? kwRaw.filter((k): k is string => typeof k === 'string')
        : [];
      intents.push({
        name: name as Intent,
        default_tier: default_tier as RecommendedTier,
        min_confidence,
        keywords,
      });
    }
  }

  return { version, default_confidence_threshold, escalation_threshold, cascade_thresholds, tier_order, intents };
}

function numberAt(obj: Record<string, YamlNode>, key: string, fallback: number): number {
  const v = obj[key];
  return typeof v === 'number' ? v : fallback;
}

// ─── Rules loader ────────────────────────────────────────────────────────

let _cached: RoutingRules | null = null;

function defaultRulesPath(): string {
  // Walk up from the compiled file location (dist/) and the source location
  // (src/) looking for `config/routing-rules.yaml`. The compiled CJS output
  // gives us `__dirname` via @types/node; we accept anything that resolves.
  // Package layout:
  //   packages/local-llm-router/
  //     src/classifier-v2.ts        ← TS rootDir
  //     dist/classifier-v2.js       ← compiled (the runtime location)
  //     config/routing-rules.yaml   ← target
  // From dist/ or src/, `..` is the package root.
  const here = typeof __dirname === 'string' ? __dirname : process.cwd();
  const candidates = [
    resolve(here, '..', 'config', 'routing-rules.yaml'),
    resolve(here, 'config', 'routing-rules.yaml'),
    resolve(process.cwd(), 'config', 'routing-rules.yaml'),
    resolve(process.cwd(), 'packages', 'local-llm-router', 'config', 'routing-rules.yaml'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

/** Load the routing-rules.yaml file. Cached after first call. */
export function loadRoutingRules(path?: string): RoutingRules {
  if (path === undefined && _cached !== null) return _cached;
  const p = path ?? defaultRulesPath();
  const text = readFileSync(p, 'utf8');
  const rules = parseRoutingRulesYaml(text);
  if (path === undefined) _cached = rules;
  return rules;
}

/** Reset the in-memory cache. Exported for tests. */
export function __resetRulesCache(): void {
  _cached = null;
}

// ─── Cascade helpers ─────────────────────────────────────────────────────

export function nextTier(current: RecommendedTier, order: RecommendedTier[]): RecommendedTier | null {
  const idx = order.indexOf(current);
  if (idx < 0) return null;
  if (idx >= order.length - 1) return null;
  return order[idx + 1] ?? null;
}

export function intentRule(rules: RoutingRules, intent: Intent): IntentRule | undefined {
  return rules.intents.find(r => r.name === intent);
}

// ─── Keyword prepass ─────────────────────────────────────────────────────

/**
 * If the task spec contains a keyword for exactly one intent, short-circuit
 * the LLM call. Returns null if zero or multiple intents match.
 */
export function keywordPrepass(taskSpec: string, rules: RoutingRules): IntentResultV2 | null {
  const spec = taskSpec.toLowerCase();
  const matches: IntentRule[] = [];
  for (const rule of rules.intents) {
    if (rule.keywords.length === 0) continue;
    if (rule.keywords.some(kw => spec.includes(kw.toLowerCase()))) {
      matches.push(rule);
    }
  }
  if (matches.length !== 1) return null;
  const rule = matches[0]!;
  return {
    intent: rule.name,
    confidence: 0.92,
    needs_escalation: false,
    recommended_tier: rule.default_tier,
    next_tier: nextTier(rule.default_tier, rules.tier_order),
    needs_cascade: false,
    reasoning: `keyword-prepass: matched ${rule.keywords.find(k => spec.includes(k.toLowerCase())) ?? ''}`,
    source: 'keyword-prepass',
    rules_version: rules.version,
  };
}

// ─── Classifier system prompt (v2 emits the same JSON shape as v1) ──────

export const CLASSIFIER_V2_SYSTEM_PROMPT = `You are an intent classifier for the CAIA agent system (v2). You read a task spec and emit STRICT JSON describing what kind of work it requires.

Your output is ONLY a JSON object with these fields, no prose:

{
  "intent": one of [${INTENT_VALUES.join(', ')}],
  "confidence": float 0.0..1.0 (your subjective confidence in the intent label),
  "needs_escalation": boolean (true if the task is beyond a 7B coder model's capability),
  "recommended_tier": one of [${TIER_VALUES.join(', ')}],
  "reasoning": short string (≤120 chars) explaining the classification
}

Tier guidance:
- local-7b: classify, summarize, format, lint-fix, rename, draft-prose, fill-template, memory-search
- local-14b: medium-code, doc-write, spec-check, review-prose
- local-32b: hard-code requiring deep reasoning over multiple files
- claude: reason-over-context, new-design, architect, or anything where confidence < 0.6 on a non-code task
- stolution-batch: batch-summarize, corpus-distill, embedding-generate (CPU-OK batch work)

If the task is ambiguous, pick "unknown" with confidence < 0.5 and needs_escalation: true.

Output ONLY the JSON object. No markdown, no prose before or after, no code fences.`;

// ─── Main classifier ────────────────────────────────────────────────────

const DEFAULT_MODEL = 'qwen2.5-coder:7b';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Classify a task spec using the v2 cascade-aware classifier.
 *
 * Process:
 *   1. Run the cheap keyword prepass — exits early if exactly one intent matches.
 *   2. Otherwise, call the local LLM (Ollama, constrained-JSON mode).
 *   3. Apply rules-based post-processing:
 *      - Coerce unknown intents/tiers.
 *      - Compute `needs_cascade` and `next_tier` from cascade_thresholds.
 *      - Force escalation when confidence < escalation_threshold.
 */
export async function classifyV2(
  taskSpec: string,
  opts: ClassifyV2Options = {},
): Promise<IntentResultV2> {
  const rules = opts.rules ?? loadRoutingRules();
  if (!opts.skipKeywordPrepass) {
    const pre = keywordPrepass(taskSpec, rules);
    if (pre !== null) return pre;
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = opts.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const userPrompt = `Task spec:\n"""\n${taskSpec}\n"""\n\nClassify this task. Output only the JSON.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CLASSIFIER_V2_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 400 },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return abstainV2((e as Error).message, rules);
  }
  clearTimeout(timer);

  if (!res.ok) return abstainV2(`ollama returned ${res.status}`, rules);

  const body = (await res.json()) as { message?: { content?: string } };
  return parseClassifierV2Output(body.message?.content ?? '', rules);
}

/** Parse the v2 classifier LLM output and apply cascade post-processing. */
export function parseClassifierV2Output(raw: string, rules: RoutingRules): IntentResultV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return abstainV2(`json-parse-failed: ${raw.slice(0, 80)}`, rules);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return abstainV2('not-an-object', rules);
  }
  const obj = parsed as Record<string, unknown>;

  const intent = (typeof obj['intent'] === 'string' && (INTENT_VALUES as readonly string[]).includes(obj['intent'] as string)
    ? obj['intent'] : 'unknown') as Intent;

  const confidenceRaw = obj['confidence'];
  const confidence = typeof confidenceRaw === 'number' && confidenceRaw >= 0 && confidenceRaw <= 1
    ? confidenceRaw : 0.0;

  const reasoning = typeof obj['reasoning'] === 'string' ? (obj['reasoning'] as string).slice(0, 200) : '';

  // Determine recommended tier from rules (preferred) or model output (fallback).
  const rule = intentRule(rules, intent);
  const modelTier = typeof obj['recommended_tier'] === 'string'
    && (TIER_VALUES as readonly string[]).includes(obj['recommended_tier'] as string)
    ? (obj['recommended_tier'] as RecommendedTier) : undefined;
  const recommended_tier: RecommendedTier = rule?.default_tier ?? modelTier ?? 'claude';

  // needs_cascade: confidence below the tier's required floor.
  const tierFloor = rules.cascade_thresholds[recommended_tier] ?? rules.default_confidence_threshold;
  const needs_cascade = confidence < tierFloor;

  // needs_escalation: either confidence below escalation floor, OR model said so.
  const modelEscalation = Boolean(obj['needs_escalation']);
  const needs_escalation = modelEscalation || confidence < rules.escalation_threshold;

  return {
    intent,
    confidence,
    needs_escalation,
    recommended_tier,
    next_tier: nextTier(recommended_tier, rules.tier_order),
    needs_cascade,
    reasoning,
    source: 'llm',
    rules_version: rules.version,
  };
}

function abstainV2(reason: string, rules: RoutingRules): IntentResultV2 {
  return {
    intent: 'unknown',
    confidence: 0.0,
    needs_escalation: true,
    recommended_tier: 'claude',
    next_tier: nextTier('claude', rules.tier_order),
    needs_cascade: false,
    reasoning: `abstain: ${reason}`,
    source: 'abstain',
    rules_version: rules.version,
  };
}
