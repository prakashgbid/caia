// Stage 1 — rule-based prepass.
//
// Deterministic, pure-JS, ~0–5 ms on a 4 KB blob. Cheapest stage by orders
// of magnitude; always runs. Operations per the design doc §5.1.
//
// Phase 5 of the Local-AI-First build chain.

export interface Stage1Options {
  // Maximum lines a single "file read" blob keeps before being folded into
  // head/tail with a marker. Default 200.
  fileFoldThreshold?: number;
  // Head lines kept when folding. Default 50.
  fileFoldHead?: number;
  // Tail lines kept when folding. Default 50.
  fileFoldTail?: number;
  // Base64 lines longer than this collapse to a stub. Default 200.
  base64Threshold?: number;
  // If true, drop JSON keys whose values are `null` or `""` during
  // normalization. Default true.
  dropEmptyJsonKeys?: boolean;
  // If true, wrap entities/numbers in «protected:…» markers so Stage 2 and
  // Stage 3 leave them alone. Default true.
  protectEntities?: boolean;
}

export interface Stage1Result {
  text: string;
  // Count of protected spans inserted — telemetry uses this as a proxy
  // for "how many silent failures did the marker protect against".
  protectedSpans: number;
}

const DEFAULTS: Required<Stage1Options> = {
  fileFoldThreshold: 200,
  fileFoldHead: 50,
  fileFoldTail: 50,
  base64Threshold: 200,
  dropEmptyJsonKeys: true,
  protectEntities: true,
};

// ─── Public entry point ────────────────────────────────────────────────

export function stage1Prepass(input: string, opts: Stage1Options = {}): Stage1Result {
  const o = { ...DEFAULTS, ...opts };

  let text = input;
  text = stripAnsiBomCrlf(text);
  text = collapseWhitespace(text);
  text = dedupeBlocks(text);
  text = foldLongFileReads(text, o.fileFoldThreshold, o.fileFoldHead, o.fileFoldTail);
  text = truncateBase64(text, o.base64Threshold);
  text = normalizeJson(text, o.dropEmptyJsonKeys);

  let protectedSpans = 0;
  if (o.protectEntities) {
    const tagged = tagProtectedSpans(text);
    text = tagged.text;
    protectedSpans = tagged.count;
  }

  return { text, protectedSpans };
}

// ─── 1. ANSI / BOM / line-ending normalization ─────────────────────────

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const BOM_RE = /^﻿/;

export function stripAnsiBomCrlf(s: string): string {
  return s.replace(BOM_RE, '').replace(ANSI_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ─── 2. Whitespace collapse ────────────────────────────────────────────

export function collapseWhitespace(s: string): string {
  // Trailing whitespace on each line.
  let out = s.replace(/[ \t]+$/gm, '');
  // Runs of 2+ spaces collapse to one space (but preserve indentation —
  // only collapse spaces NOT at the start of a line). We approximate by
  // collapsing internal multi-spaces only.
  out = out.replace(/(\S) {2,}/g, '$1 ');
  // 3+ consecutive newlines → 2.
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

// ─── 3. Block dedup ────────────────────────────────────────────────────

export function dedupeBlocks(s: string, minLines = 3): string {
  const lines = s.split('\n');
  const n = lines.length;
  if (n < minLines * 2) return s;

  // Sliding-window dedup: for each starting line, find the largest k≥minLines
  // such that lines[i..i+k) appears repeated. Greedy left-to-right.
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    let bestK = 0;
    let bestRepeats = 0;
    // Try block sizes from minLines up to half the remaining length.
    const maxK = Math.min(40, Math.floor((n - i) / 2));
    for (let k = minLines; k <= maxK; k++) {
      const block = lines.slice(i, i + k).join('\n');
      if (block.trim() === '') continue;
      // Count consecutive repeats.
      let repeats = 1;
      let cursor = i + k;
      while (cursor + k <= n && lines.slice(cursor, cursor + k).join('\n') === block) {
        repeats++;
        cursor += k;
      }
      if (repeats >= 2 && k * repeats > bestK * bestRepeats) {
        bestK = k;
        bestRepeats = repeats;
      }
    }
    if (bestK > 0 && bestRepeats >= 2) {
      out.push(...lines.slice(i, i + bestK));
      out.push(`(repeated ${bestRepeats}×)`);
      i += bestK * bestRepeats;
    } else {
      out.push(lines[i] ?? '');
      i++;
    }
  }
  return out.join('\n');
}

// ─── 4. Fold long file reads ──────────────────────────────────────────

export function foldLongFileReads(
  s: string,
  threshold: number,
  head: number,
  tail: number,
): string {
  const lines = s.split('\n');
  if (lines.length <= threshold) return s;

  const headSlice = lines.slice(0, head);
  const tailSlice = lines.slice(lines.length - tail);
  const omitted = lines.length - head - tail;
  return [...headSlice, `(...${omitted} lines omitted...)`, ...tailSlice].join('\n');
}

// ─── 5. Base64 / binary stub truncation ───────────────────────────────

const SHA256_HEX_PREFIX_LEN = 12;

export function truncateBase64(s: string, threshold: number): string {
  const re = new RegExp(`^[A-Za-z0-9+/=]{${threshold},}$`, 'gm');
  return s.replace(re, (m) => {
    const head = m.slice(0, 40);
    const hash = cheapHash(m).slice(0, SHA256_HEX_PREFIX_LEN);
    return `${head}...truncated:${hash}...`;
  });
}

// FNV-1a 64-bit hash, output as hex. Cheap, no crypto dep, stable across
// Node versions. Not cryptographic — just a content-addressed marker.
function cheapHash(s: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    hash ^= BigInt(s.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

// ─── 6. JSON normalize ────────────────────────────────────────────────

export function normalizeJson(s: string, dropEmpty: boolean): string {
  // Find fenced JSON blocks (```json ... ```) and free JSON-ish blobs
  // (starting with { or [ on a line, ending on a balanced brace). Each is
  // re-emitted with sorted keys.
  let out = s;

  // Fenced ```json``` blocks.
  out = out.replace(/```json\s*\n([\s\S]*?)\n```/g, (_match, body) => {
    const norm = tryNormalize(body, dropEmpty);
    return norm == null ? _match : '```json\n' + norm + '\n```';
  });

  // We deliberately don't try to normalize bare top-level JSON blobs
  // floating in prose — too brittle and likely to corrupt the prompt.

  return out;
}

function tryNormalize(body: string, dropEmpty: boolean): string | null {
  try {
    const parsed = JSON.parse(body);
    const cleaned = dropEmpty ? dropEmptyValues(parsed) : parsed;
    return JSON.stringify(cleaned, sortedReplacer, 2);
  } catch {
    return null;
  }
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = obj[k];
    }
    return sorted;
  }
  return value;
}

function dropEmptyValues(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(dropEmptyValues);
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === '') continue;
      out[k] = dropEmptyValues(val);
    }
    return out;
  }
  return v;
}

// ─── 7. Protected-span tagging ────────────────────────────────────────
//
// The v1 NER list from the design doc §5.5. Ordered most-specific to
// least-specific so we don't double-tag (e.g. a SHA inside a path).

interface SpanRule {
  name: string;
  pattern: RegExp;
}

const SPAN_RULES: SpanRule[] = [
  // Absolute Unix file paths.
  { name: 'path', pattern: /(?<![A-Za-z0-9])\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,6}\b/g },
  // Relative paths with explicit ./ or ../
  { name: 'path', pattern: /\.{1,2}\/[A-Za-z0-9._/-]+/g },
  // Email addresses.
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // GitHub-shaped @handles.
  { name: 'handle', pattern: /(?<![\w])@[A-Za-z0-9-]{1,39}(?![\w@])/g },
  // @chiefaia/* package names.
  { name: 'pkg', pattern: /@chiefaia\/[a-z][a-z0-9-]*/g },
  // IPv4 addresses.
  { name: 'ip', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Hostnames matching stolution / caia / tail<hex>.
  {
    name: 'host',
    pattern: /\b[a-z0-9-]+\.(?:stolution|caia|tail[0-9a-f]+)(?:\.[a-z0-9-]+)*\b/g,
  },
  // Hex SHAs ≥ 7 chars.
  { name: 'sha', pattern: /\b[0-9a-f]{7,40}\b/g },
  // ISO datetimes.
  { name: 'date', pattern: /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?\b/g },
  // Currency amounts.
  { name: 'money', pattern: /(?:[$€£¥]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|JPY))\b/g },
  // Percentages.
  { name: 'pct', pattern: /\b\d+(?:\.\d+)?%/g },
  // Backtick-quoted identifiers.
  { name: 'ident', pattern: /`[A-Za-z_][A-Za-z0-9_.-]{1,80}`/g },
];

const PROTECT_OPEN = '«protected:';
const PROTECT_CLOSE = '»';
// Marker line we use during span tagging to make sure replacements don't
// nest inside already-tagged text. We pick a sentinel unlikely to appear
// naturally in operator prompts.
const SENTINEL_BEFORE = '\x01';
const SENTINEL_AFTER = '\x02';

export function tagProtectedSpans(s: string): { text: string; count: number } {
  let working = s;
  let count = 0;

  for (const rule of SPAN_RULES) {
    working = working.replace(rule.pattern, (match) => {
      // Skip if already inside a protected span (cheap check: surrounded
      // by sentinels).
      if (match.includes(SENTINEL_BEFORE) || match.includes(SENTINEL_AFTER)) return match;
      count++;
      return `${SENTINEL_BEFORE}${PROTECT_OPEN}${rule.name}:${match}${PROTECT_CLOSE}${SENTINEL_AFTER}`;
    });
  }

  // Remove sentinels — they were only there to prevent re-tagging.
  working = working.replace(new RegExp(SENTINEL_BEFORE, 'g'), '');
  working = working.replace(new RegExp(SENTINEL_AFTER, 'g'), '');
  return { text: working, count };
}

// Helper for downstream stages: detect whether a token sequence falls
// inside a protected span. Stages 2/3 use this to force-keep certain
// tokens.
const PROTECTED_REGION_RE = /«protected:[^»]*»/g;

export function findProtectedRanges(s: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of s.matchAll(PROTECTED_REGION_RE)) {
    if (m.index == null) continue;
    const matched = m[0];
    if (matched == null) continue;
    ranges.push([m.index, m.index + matched.length]);
  }
  return ranges;
}

export function isIndexProtected(idx: number, ranges: Array<[number, number]>): boolean {
  // Binary search would be faster but ranges count is small.
  for (const [start, end] of ranges) {
    if (idx >= start && idx < end) return true;
  }
  return false;
}
