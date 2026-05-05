/**
 * Curator Phase-2 — operator-curated industry-briefing watchlist.
 *
 * Per `agent/memory/curator_agent_directive.md` ## Output modes:
 *   "Industry briefings — for genuinely-relevant new tech (model
 *    release, framework drop), a one-pager: what it is, what it'd
 *    change for us, recommended action."
 *
 * The watchlist is a small JSON file the operator maintains by hand
 * (path: `<memoryDir>/curator-watchlist.json`). Each entry describes
 * one topic Curator should produce a briefing for. Curator does NOT
 * fetch RSS feeds or hit the network in Phase-2 — keeping that out
 * makes the scanner deterministic + offline-testable + free
 * (subscription-only mandate).
 *
 * A future PR can replace this with a real RSS/HN/arxiv scanner once
 * we've got Ollama-augmented summarisation working. Until then, the
 * operator drops topics into the watchlist + Curator turns each into
 * a structured one-pager on a known schedule.
 *
 * Watchlist file shape:
 *
 *   {
 *     "version": 1,
 *     "entries": [
 *       {
 *         "topic": "anthropic-claude-opus-4-6-release",
 *         "title": "Claude Opus 4.6 — what it'd change for us",
 *         "summary": "Anthropic released Opus 4.6 on <date>. Key deltas: ...",
 *         "sourceUrl": "https://...",
 *         "evidence": ["...", "..."],
 *         "recommendation": "Run our canonical eval suite against 4.6 ..."
 *       }
 *     ]
 *   }
 *
 * Missing fields fall back to sensible defaults (empty arrays, "TBD").
 *
 * The scanner returns `IndustryBriefingAction[]` directly (not Findings)
 * because this output mode is operator-driven, not metric-driven — the
 * mapping from a watchlist entry to an action is 1:1.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IndustryBriefingAction } from './types.js';
import { slugify } from './classifier.js';

/** Default watchlist path: `<memoryDir>/curator-watchlist.json`. */
export function defaultWatchlistPath(memoryDir: string): string {
  return join(memoryDir, 'curator-watchlist.json');
}

/**
 * Shape of a watchlist entry. Optional fields fall back to defaults
 * inside `loadWatchlist` so callers always see a complete record.
 */
export interface WatchlistEntry {
  /** Stable id used for slug + frontmatter. */
  topic: string;
  /** Human-readable headline. Falls back to the topic if missing. */
  title?: string;
  /** Paragraph describing the topic. Defaults to "TBD — operator note pending.". */
  summary?: string;
  /** Optional source URL (link to the release / paper / blog). */
  sourceUrl?: string;
  /** Optional list of supporting evidence lines. */
  evidence?: string[];
  /** Optional recommendation. Defaults to a generic "evaluate" prompt. */
  recommendation?: string;
}

/** Top-level watchlist file shape. */
export interface WatchlistFile {
  /** Schema version. Currently 1. */
  version?: number;
  /** Entries. Empty list = no briefings to emit. */
  entries: WatchlistEntry[];
}

/** Options for `loadWatchlist`. */
export interface LoadWatchlistOptions {
  /** Explicit path. Overrides `memoryDir`. */
  path?: string;
  /** Memory dir; the path becomes `<memoryDir>/curator-watchlist.json`. */
  memoryDir?: string;
  /** Injected clock; defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Load + parse the watchlist + convert each entry to a fully-populated
 * `IndustryBriefingAction`. If the file doesn't exist OR is empty,
 * returns an empty array (NOT an error — the operator may not have
 * filed any topics yet).
 *
 * Throws on JSON parse error so the caller can surface it. Validation
 * is intentionally minimal (Phase-2 trust-the-operator approach); a
 * future PR can add zod / ajv schema if needed.
 */
export function loadWatchlist(
  opts: LoadWatchlistOptions = {}
): IndustryBriefingAction[] {
  const path = resolvePath(opts);
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, 'utf-8').trim();
  if (raw === '') return [];

  const parsed = JSON.parse(raw) as Partial<WatchlistFile>;
  const entries: WatchlistEntry[] = Array.isArray(parsed.entries)
    ? parsed.entries
    : [];
  const detectedAt = (opts.now ?? ((): Date => new Date()))().toISOString();

  return entries.map((entry) => entryToAction(entry, detectedAt));
}

function entryToAction(
  entry: WatchlistEntry,
  detectedAt: string
): IndustryBriefingAction {
  const title = (entry.title ?? entry.topic).trim();
  const summary = (
    entry.summary ?? 'TBD — operator note pending.'
  ).trim();
  const recommendation = (
    entry.recommendation ??
    'Evaluate impact on our stack; if relevant, file a follow-up directive or PR.'
  ).trim();
  const evidence = Array.isArray(entry.evidence) ? [...entry.evidence] : [];
  const slug = `industry-briefing-${slugify(entry.topic)}`.slice(0, 80);

  const action: IndustryBriefingAction = {
    kind: 'industry-briefing',
    slug,
    title,
    summary,
    evidence,
    recommendation,
    detectedAt,
    sourceFindings: [], // Industry briefings don't originate from Findings.
    topic: entry.topic
  };
  if (entry.sourceUrl !== undefined) {
    action.sourceUrl = entry.sourceUrl;
  }
  return action;
}

function resolvePath(opts: LoadWatchlistOptions): string {
  if (opts.path !== undefined) return opts.path;
  if (opts.memoryDir === undefined) {
    throw new Error(
      'loadWatchlist: either `path` or `memoryDir` must be provided'
    );
  }
  return defaultWatchlistPath(opts.memoryDir);
}
