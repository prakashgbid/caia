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
import { buildClassifierUserMessage } from './prompt-template.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface IntentRule {
  name: Intent;
  default_tier: RecommendedTier;
  min_confidence: number;
  keywords: string[];
}

/**
 * GB-12 (2026-05-15) — per-tier model + timeout config. Lets the runtime resolve
 * `{tier, intent} → {model, timeout_ms}` without a code change for tag rotations.
 */
export interface TierModelConfig {
  /** Per-request CPU latency budget in ms. */
  timeout_ms: number;
  /** Fallback model when no per_intent override applies. */
  default_model: string;
  /** Intent name → ollama tag served by this tier. */
  per_intent: Record<string, string>;
}

export interface RoutingRules {
  version: number;
  default_confidence_threshold: number;
  escalation_threshold: number;
  cascade_thresholds: Record<string, number>;
  tier_order: RecommendedTier[];
  intents: IntentRule[];
  /** GB-12 (2026-05-15) — optional per-tier model+timeout block. */
  tier_models: Record<string, TierModelConfig>;
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

  // GB-12 (2026-05-15) — optional `tier_models` block. Shape:
  //   tier_models:
  //     <tier-name>:
  //       timeout_ms: <int>
  //       default_model: <string>
  //       per_intent:
  //         <intent>: <model-tag>
  // Unknown tiers are accepted (forward-compat); invalid scalar types are dropped.
  const tier_models: Record<string, TierModelConfig> = {};
  const tmRaw = root['tier_models'];
  if (typeof tmRaw === 'object' && tmRaw !== null && !Array.isArray(tmRaw)) {
    for (const [tier, cfgRaw] of Object.entries(tmRaw)) {
      if (typeof cfgRaw !== 'object' || cfgRaw === null || Array.isArray(cfgRaw)) continue;
      const cfg = cfgRaw as Record<string, YamlNode>;
      const timeout_ms = typeof cfg['timeout_ms'] === 'number' ? cfg['timeout_ms'] as number : 0;
      const default_model = typeof cfg['default_model'] === 'string' ? cfg['default_model'] as string : '';
      const per_intent: Record<string, string> = {};
      const piRaw = cfg['per_intent'];
      if (typeof piRaw === 'object' && piRaw !== null && !Array.isArray(piRaw)) {
        for (const [intent, model] of Object.entries(piRaw)) {
          if (typeof model === 'string' && model.length > 0) per_intent[intent] = model;
        }
      }
      // Require at least timeout_ms or default_model to register the tier;
      // an empty block is treated as absent.
      if (timeout_ms > 0 || default_model !== '' || Object.keys(per_intent).length > 0) {
        tier_models[tier] = { timeout_ms, default_model, per_intent };
      }
    }
  }

  return { version, default_confidence_threshold, escalation_threshold, cascade_thresholds, tier_order, intents, tier_models };
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

CRITICAL OUTPUT CONTRACT: Emit a JSON object with EXACTLY these five keys — "intent", "confidence", "needs_escalation", "recommended_tier", "reasoning". Do NOT invent keys like "task_type", "type", "task", "category", "description", "input_validation", "old", "new". Do NOT return a bare string label. Do NOT wrap the object in another field. No markdown, no code fences, no prose before or after — ONLY the JSON object.

Schema:
{
  "intent": one of [${INTENT_VALUES.join(', ')}],
  "confidence": float 0.0..1.0 (your subjective confidence in the intent label),
  "needs_escalation": boolean (true ONLY when one of the three escalation triggers below applies),
  "recommended_tier": one of [${TIER_VALUES.join(', ')}],
  "reasoning": short string (≤120 chars) explaining the classification
}

ONE-SHOT EXAMPLE — single-file rename:
INPUT: "Rename the React component Btn to PrimaryButton across the file."
OUTPUT: {"intent":"rename","confidence":0.92,"needs_escalation":false,"recommended_tier":"local-7b","reasoning":"single-file symbol rename, bounded scope"}

TIER MAPPING (RouteLLM-style — bias toward local tiers; cloud is the exception, not the default).

local-7b — bounded, single-shot, single-artifact work. Default for:
  rename, format, format-convert, lint-fix, summarize, doc-summarize, classify,
  draft-prose (short), fill-template, memory-search, small-code-edit, code-explain,
  doc-update, extract, error-recovery, prose-rewrite.
  Pick this tier when the spec names a single file/function/string and the work
  is one-shot. Confidence ≥ 0.50 keeps the task here.

local-14b — moderate code or prose with internal structure but bounded scope.
  Default for: medium-code, code-review, test-gen, doc-write, spec-check,
  review-prose, schema-design, longer draft-prose tasks.
  Pick this tier when the work touches one file or one logical unit and needs
  more reasoning than a 7B can carry. Confidence ≥ 0.50 keeps the task here.

local-32b — hard code, multi-file refactors, or module-level design that still
  has a concrete spec. Default for: hard-code, architecture, new-design.
  An enumerated multi-file refactor or a JSON-schema / Postgres-DDL / OpenAPI
  design BELONGS HERE, not on claude. Confidence ≥ 0.45 keeps the task here.

stolution-batch — batch / long-context / corpus-scale work where CPU latency
  is acceptable. Default for: batch-summarize, corpus-distill, research-synthesis,
  long-context-reason, embedding-generate.

claude — RESERVED for cloud escalation. Emit recommended_tier="claude"
  (or needs_escalation=true) ONLY when at least one of these triggers holds:
  (1) REASONING OVER NOVEL CONTEXT not present in the spec — e.g. "given
      everything you know about our system, decide…", "infer what the operator
      meant", "reason over the live conversation". The model must invent
      context to answer.
  (2) CROSS-FILE EDITS where the file list is NOT enumerated and must be
      discovered. Note: an enumerated multi-file refactor is local-32b, not
      claude. Only escalate when discovery itself is the hard part.
  (3) WHOLE-SYSTEM ARCHITECTURE DECISIONS that span services or require
      synthesis across the entire system — that's intent: architect. Module-
      level design is local-32b (intent: architecture or new-design).

DO NOT escalate just because the task feels "open-ended". If the spec names
a file, function, symbol, schema, single artifact, or single logical unit —
choose a local tier. Most bounded code and prose intents belong on local-7b
or local-14b.

PER-INTENT CONFIDENCE FLOORS (permissive, calibrated per P3):
  - local-7b bounded intents (rename, format, format-convert, summarize,
    doc-summarize, classify, draft-prose, memory-search, small-code-edit,
    code-explain, doc-update, prose-rewrite, extract, error-recovery,
    lint-fix, fill-template): floor 0.50. Below 0.50, cascade up — don't jump
    to claude.
  - local-14b intents (medium-code, code-review, test-gen, doc-write,
    schema-design, review-prose, spec-check): floor 0.50.
  - local-32b intents (hard-code, architecture, new-design): floor 0.45.
  - stolution-batch intents: floor 0.50.
  - reason-over-context, architect (the only intrinsically-claude intents):
    no floor — these always go to claude.

If the task is ambiguous AND none of the three escalation triggers apply,
pick the nearest plausible local intent at confidence ~0.40 and let the
cascade controller promote tiers. Reserve intent="unknown" for prompts that
are empty, non-task, or adversarial; do NOT use "unknown" as a hedge.

Output ONLY the JSON object with EXACTLY the five keys above.`;

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

  // R-3 fix: route through the byte-stable, sanitising prompt template
  // (see src/prompt-template.ts). CLASSIFIER_V2_SYSTEM_PROMPT is the
  // byte-stable preamble; buildClassifierUserMessage() owns the user
  // envelope (prefix + sanitised input + suffix).
  const userPrompt = buildClassifierUserMessage(taskSpec);
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
