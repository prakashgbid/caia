/**
 * EA Repository loader.
 *
 * Reads the on-disk EA Repository at the configured root (default
 * `~/Documents/projects/caia-ea/`) and builds an in-memory index of all
 * ADRs, principles, lessons-learned, and risks. Also reads the seven
 * feedback memories the operator named as agent context. The loader is
 * pure-disk + pure-CPU; no network, no LLM. It runs on every review so
 * the repository stays the source of truth — there is no cached stale
 * copy.
 *
 * The relevance index is a simple keyword + section-based score; that is
 * sufficient for the EA Repository at v1 (<100 ADRs, <30k words total).
 * If the repository scales past that, switch the index to query the
 * `@chiefaia/architecture-registry` AKG (which already does
 * embeddings-augmented search).
 */

import { join } from 'node:path';

import { defaultFsAdapter } from './fs-adapter.js';
import type {
  AdrRecord,
  EaRepository,
  FeedbackRecord,
  FsAdapter,
  LessonRecord,
  PrincipleRecord,
  RelevanceMatch,
  RelevantContext,
  RiskRecord
} from './types.js';

const ADR_FILENAME_RE = /^ADR-(\d+)-(.+)\.md$/;

/** Tokenise text into lowercase keywords, dropping stopwords. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'but', 'the', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as',
  'from', 'into', 'through', 'during', 'this', 'that', 'these', 'those',
  'we', 'our', 'they', 'their', 'it', 'its', 'not', 'no', 'so', 'too',
  'very', 'just', 'than', 'then', 'now', 'also', 'only', 'any', 'all',
  'each', 'every', 'some', 'such', 'one', 'two', 'three', 'first',
  'last', 'next', 'per', 'via', 'when', 'where', 'while', 'because',
  'if', 'else', 'how', 'what', 'which', 'who', 'whom', 'why', 'has',
  'i', 'me', 'my', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  's', 't', 'd', 'll', 're', 've', 'm', 'between'
]);

export function tokenise(text: string): string[] {
  const out: string[] = [];
  const lowered = text.toLowerCase();
  const matches = lowered.match(/[a-z][a-z0-9-]*/g) ?? [];
  for (const m of matches) {
    if (m.length < 3) continue;
    if (STOPWORDS.has(m)) continue;
    out.push(m);
  }
  return out;
}

/** Parse the ADR header block into a small lookup map. */
function parseAdrHeader(body: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const headerLines = body.split('\n').slice(0, 25);
  for (const line of headerLines) {
    // Match "- **Status:** value" or "- Status: value".
    // The key sits between "- " (and optional "**") and "**: " / ": ".
    const m = line.match(/^-\s+(?:\*\*)?([A-Za-z][A-Za-z0-9 -]*?)(?:\*\*)?:\s*(.+?)\s*$/);
    if (m !== null && m[1] !== undefined && m[2] !== undefined) {
      // Strip stray leading/trailing markdown emphasis from the value.
      const value = m[2].replace(/^\*+\s*/, '').replace(/\s*\*+$/, '').trim();
      headers[m[1].trim().toLowerCase()] = value;
    }
  }
  return headers;
}

/** Best-effort extract of "ADR-NNN" tokens from text. */
export function extractAdrIds(text: string): string[] {
  const matches = text.match(/ADR-\d{3}/g) ?? [];
  return [...new Set(matches)];
}

/** Read one ADR file. */
function readAdr(fs: FsAdapter, filePath: string, id: number): AdrRecord {
  const body = fs.readFile(filePath);
  const headers = parseAdrHeader(body);
  const titleMatch = body.match(/^#\s*ADR-\d+\s*[—\-:]\s*(.+)$/m);
  const title = (titleMatch?.[1] ?? '').trim();
  const adrId = `ADR-${id.toString().padStart(3, '0')}`;
  const status = headers['status'] ?? 'Unknown';
  const affected = (headers['affected-components'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const keywords = tokenise(`${title} ${body}`);
  return {
    id,
    adrId,
    filePath,
    title,
    status,
    affectedComponents: affected,
    body,
    keywords
  };
}

/** Parse principles file into one record per "## P<N>" section. */
function parsePrinciples(body: string): PrincipleRecord[] {
  const out: PrincipleRecord[] = [];
  // Match "## P1 — Title" headings (em-dash or hyphen).
  const sections = body.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const headerEnd = section.indexOf('\n');
    if (headerEnd < 0) continue;
    const headerLine = section.slice(0, headerEnd).trim();
    const idMatch = headerLine.match(/^(P\d+)\s*[—\-:]\s*(.+)$/);
    if (idMatch === null) continue;
    const id = idMatch[1] ?? '';
    const title = (idMatch[2] ?? '').trim();
    const sectionBody = section.slice(headerEnd + 1);
    // Stop before "## Amendment process" footer or the next "##".
    const stopIdx = sectionBody.search(/\n##\s+/);
    const body = stopIdx >= 0 ? sectionBody.slice(0, stopIdx) : sectionBody;
    const keywords = tokenise(`${title} ${body}`);
    out.push({ id, title, body, keywords });
  }
  return out;
}

/** Parse a single lesson markdown file. */
function readLesson(fs: FsAdapter, filePath: string, basename: string): LessonRecord {
  const body = fs.readFile(filePath);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = (titleMatch?.[1] ?? basename).trim();
  // Lesson id = filename without extension, e.g. "01-pixel-perfect-calibration"
  const id = basename.replace(/\.md$/, '');
  return {
    id,
    filePath,
    title,
    body,
    keywords: tokenise(`${title} ${body}`)
  };
}

/**
 * Parse the risk register markdown (best-effort).
 *
 * Looks for "### <Category>" or "## <Category>" headers and aggregates
 * their contents into one record per heading.
 */
function parseRisks(body: string): RiskRecord[] {
  const out: RiskRecord[] = [];
  const sections = body.split(/^##\s+/m).slice(1);
  let idx = 1;
  for (const section of sections) {
    const headerEnd = section.indexOf('\n');
    if (headerEnd < 0) continue;
    const heading = section.slice(0, headerEnd).trim();
    const sectionBody = section.slice(headerEnd + 1);
    const stopIdx = sectionBody.search(/\n##\s+/);
    const txt = stopIdx >= 0 ? sectionBody.slice(0, stopIdx) : sectionBody;
    out.push({
      id: `RISK-${idx.toString().padStart(2, '0')}`,
      category: heading,
      description: heading,
      body: txt,
      keywords: tokenise(`${heading} ${txt}`)
    });
    idx += 1;
  }
  return out;
}

/** Parse a feedback memory file into a FeedbackRecord. */
function readFeedback(fs: FsAdapter, filePath: string, basename: string): FeedbackRecord | null {
  const body = fs.readFile(filePath);
  // Frontmatter name field.
  const fm = body.match(/^---\s*\nname:\s*([^\n]+)/);
  const id = (fm?.[1] ?? basename.replace(/\.md$/, '')).trim();
  const titleMatch = body.match(/description:\s*([^\n]+)/);
  const title = (titleMatch?.[1] ?? basename).trim();
  return {
    id,
    filePath,
    title,
    body,
    keywords: tokenise(`${title} ${body}`)
  };
}

/**
 * Load the EA Repository from disk.
 *
 * @param rootPath the repository root (e.g. `~/Documents/projects/caia-ea`)
 * @param agentMemoryPath the agent-memory dir for feedback memory files
 */
export function loadRepository(
  rootPath: string,
  agentMemoryPath: string,
  fs: FsAdapter = defaultFsAdapter
): EaRepository {
  // ADRs
  const decisionsDir = join(rootPath, 'decisions');
  const adrFiles = fs
    .readDir(decisionsDir)
    .filter((name) => ADR_FILENAME_RE.test(name))
    .sort();
  const adrs: AdrRecord[] = [];
  let maxAdrId = 0;
  for (const name of adrFiles) {
    const match = name.match(ADR_FILENAME_RE);
    if (match === null || match[1] === undefined) continue;
    const id = Number.parseInt(match[1], 10);
    if (Number.isNaN(id)) continue;
    const filePath = join(decisionsDir, name);
    adrs.push(readAdr(fs, filePath, id));
    if (id > maxAdrId) maxAdrId = id;
  }

  // Principles
  const principlesFile = join(rootPath, 'principles', '00-architecture-principles.md');
  let principles: PrincipleRecord[] = [];
  if (fs.exists(principlesFile)) {
    principles = parsePrinciples(fs.readFile(principlesFile));
  }

  // Lessons-learned
  const lessonsDir = join(rootPath, 'lessons-learned');
  const lessonFiles = fs.readDir(lessonsDir).filter((n) => n.endsWith('.md')).sort();
  const lessons: LessonRecord[] = [];
  for (const name of lessonFiles) {
    lessons.push(readLesson(fs, join(lessonsDir, name), name));
  }

  // Risk register
  const riskFile = join(rootPath, 'risk-register', '00-current-risks.md');
  let risks: RiskRecord[] = [];
  if (fs.exists(riskFile)) {
    risks = parseRisks(fs.readFile(riskFile));
  }

  // Feedback memories — the seven the operator named.
  const FEEDBACK_FILES = [
    'feedback_no_timelines.md',
    'feedback_no_idle_no_waiting.md',
    'feedback_auto_merge_prs.md',
    'feedback_action_research_outputs.md',
    'feedback_ea_agent_gates_research.md',
    'feedback_caia_build_uses_pro_subscription_only.md',
    'project_caia_shadcn_react_first_locked.md'
  ];
  const feedback: FeedbackRecord[] = [];
  for (const name of FEEDBACK_FILES) {
    const fp = join(agentMemoryPath, name);
    if (!fs.exists(fp)) continue;
    const rec = readFeedback(fs, fp, name);
    if (rec !== null) feedback.push(rec);
  }

  return {
    rootPath,
    adrs,
    principles,
    lessons,
    risks,
    feedback,
    maxAdrId
  };
}

/**
 * Score an item by keyword overlap with the query tokens.
 *
 * Simple TF-style score: per matched keyword, count the keyword
 * occurrences in the item's keyword list. The list is bounded by
 * `topN`. Returns the matches sorted descending by score.
 */
function scoreItems<T extends { keywords: string[] }>(
  items: T[],
  queryTokens: string[],
  topN: number,
  /** Minimum score floor; anything below gets dropped. */
  floor = 1
): RelevanceMatch<T>[] {
  const out: RelevanceMatch<T>[] = [];
  const querySet = new Set(queryTokens);
  for (const item of items) {
    let score = 0;
    const matched: string[] = [];
    const seen = new Set<string>();
    for (const kw of item.keywords) {
      if (querySet.has(kw)) {
        score += 1;
        if (!seen.has(kw)) {
          matched.push(kw);
          seen.add(kw);
        }
      }
    }
    if (score >= floor) {
      out.push({ item, score, matchedKeywords: matched });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, topN);
}

export interface RelevanceOptions {
  maxAdrs?: number;
  maxPrinciples?: number;
  maxLessons?: number;
  maxRisks?: number;
  maxFeedback?: number;
  /** Always-included ADR ids (forced even if not matched). */
  forceAdrIds?: string[];
}

/**
 * Pick the topic-relevant slice of the repository for context injection
 * into the critic prompt.
 *
 * Tokenises the query (plan markdown + affected components + plan type)
 * and ranks every item by keyword overlap. Principles are special-cased
 * — by default ALL principles are returned, since every plan is checked
 * against every principle (P9 demands this).
 */
export function selectRelevantContext(
  repo: EaRepository,
  query: string,
  affectedComponents: string[],
  opts: RelevanceOptions = {}
): RelevantContext {
  const maxAdrs = opts.maxAdrs ?? 12;
  const maxLessons = opts.maxLessons ?? 4;
  const maxRisks = opts.maxRisks ?? 5;
  const maxFeedback = opts.maxFeedback ?? 7;

  const tokens = [
    ...tokenise(query),
    ...affectedComponents.flatMap((c) => tokenise(c))
  ];

  // Force-include any ADRs cited by id in the query text. The plan
  // markdown may name ADRs that are not keyword-matched but that the
  // proposer believes are relevant.
  const citedIds = new Set([...extractAdrIds(query), ...(opts.forceAdrIds ?? [])]);

  const adrMatches = scoreItems(repo.adrs, tokens, maxAdrs, 1);
  // Ensure cited ADRs are always present.
  const presentIds = new Set(adrMatches.map((m) => m.item.adrId));
  for (const id of citedIds) {
    if (presentIds.has(id)) continue;
    const adr = repo.adrs.find((a) => a.adrId === id);
    if (adr === undefined) continue;
    adrMatches.push({ item: adr, score: 1, matchedKeywords: ['forced'] });
  }

  // ALL principles — every plan must be checked against every principle.
  const principles: RelevanceMatch<PrincipleRecord>[] = repo.principles.map((p) => ({
    item: p,
    score: 1,
    matchedKeywords: []
  }));

  const lessons = scoreItems(repo.lessons, tokens, maxLessons, 1);
  const risks = scoreItems(repo.risks, tokens, maxRisks, 1);
  // Feedback memories: all of them, since they're operator-mandated lenses.
  const feedback: RelevanceMatch<FeedbackRecord>[] = repo.feedback.slice(0, maxFeedback).map((f) => ({
    item: f,
    score: 1,
    matchedKeywords: []
  }));

  return { adrs: adrMatches, principles, lessons, risks, feedback };
}
