/**
 * @caia/reuse-searcher — index + rank workspace packages by relevance to a brief.
 *
 * Layer L3 of the reuse-first guardrail (ADR-065). Orchestrators call
 * `searchReuseCandidates(brief)` before spawning any code task; the
 * returned candidate list is injected into the spawned agent's prompt.
 *
 * Pure-function core (tokenize → score → rank). I/O lives in `loadIndex`
 * and is cached on `pnpm-lock.yaml` mtime.
 */

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { tokenize } from "./tokenize.js";
import { scorePackage, type PackageRecord, type ScoreBreakdown } from "./score.js";

export interface RankedCandidate {
  packageName: string;
  description: string;
  mainExports: readonly string[];
  matchScore: number;          // normalised [0, 1]
  matchReasons: readonly string[];
}

export interface SearchOptions {
  /** Default: caia repo root `<cwd>/packages` discovery. */
  packagesRoot?: string;
  /** Default: 10. */
  topN?: number;
  /** Scope filters; default: ["@caia/", "@chiefaia/", "@stolution/", "@pokerzeno/"]. */
  scopes?: readonly string[];
  /** Test-injection hook: skip the disk read entirely. */
  inMemoryPackages?: readonly RawPackage[];
  /** Override lockfile path used for cache invalidation. */
  lockfilePath?: string;
}

/** Subset of package.json the searcher reads. */
export interface RawPackage {
  name: string;
  description?: string;
  keywords?: readonly string[];
  /** Best-effort exported identifier list. */
  exports?: readonly string[];
}

const DEFAULT_SCOPES = ["@caia/", "@chiefaia/", "@stolution/", "@pokerzeno/"] as const;

interface IndexCache {
  lockfileMtimeMs: number;
  records: readonly PackageRecord[];
}
const cache = new Map<string, IndexCache>();

function intoTokenSet(text: string): ReadonlySet<string> {
  return new Set(tokenize(text));
}

function buildRecord(raw: RawPackage): PackageRecord {
  return {
    packageName: raw.name,
    description: raw.description ?? "",
    keywords: raw.keywords ?? [],
    mainExports: raw.exports ?? [],
    tokens: {
      // Split on /, -, _ in the name so "@caia/ui" → ["caia","ui"]
      name: intoTokenSet(raw.name.replace(/[@/_-]/g, " ")),
      description: intoTokenSet(raw.description ?? ""),
      keywords: intoTokenSet((raw.keywords ?? []).join(" ")),
      exports: intoTokenSet((raw.exports ?? []).join(" ")),
    },
  };
}

function inScope(name: string, scopes: readonly string[]): boolean {
  return scopes.some((s) => name.startsWith(s));
}

/** Read a single package.json safely; tolerates malformed JSON / missing fields. */
async function tryReadPackageJson(path: string): Promise<RawPackage | null> {
  try {
    const txt = await fs.readFile(path, "utf-8");
    const json = JSON.parse(txt) as Record<string, unknown>;
    const name = typeof json.name === "string" ? json.name : undefined;
    if (!name) return null;
    const description = typeof json.description === "string" ? json.description : undefined;
    const keywords = Array.isArray(json.keywords) ? json.keywords.filter((k): k is string => typeof k === "string") : undefined;
    // Best-effort exports inference: top-level "exports" object keys + "main" file basename hint.
    const exportNames: string[] = [];
    if (json.exports && typeof json.exports === "object") {
      for (const k of Object.keys(json.exports as Record<string, unknown>)) {
        if (k !== "." && !k.startsWith("./.")) exportNames.push(k.replace(/^\.\/+/, ""));
      }
    }
    const result: RawPackage = { name };
    if (description !== undefined) result.description = description;
    if (keywords !== undefined) result.keywords = keywords;
    if (exportNames.length > 0) result.exports = exportNames;
    return result;
  } catch {
    return null;
  }
}

async function loadIndexFromDisk(packagesRoot: string, scopes: readonly string[]): Promise<readonly PackageRecord[]> {
  const entries = await fs.readdir(packagesRoot, { withFileTypes: true }).catch(() => []);
  const records: PackageRecord[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pjPath = join(packagesRoot, e.name, "package.json");
    const raw = await tryReadPackageJson(pjPath);
    if (!raw) continue;
    if (!inScope(raw.name, scopes)) continue;
    records.push(buildRecord(raw));
  }
  return records;
}

async function getIndex(opts: Required<Pick<SearchOptions, "packagesRoot" | "scopes" | "lockfilePath">>): Promise<readonly PackageRecord[]> {
  const cacheKey = `${opts.packagesRoot}::${opts.scopes.join(",")}`;
  let lockMtime = 0;
  try {
    const st = await fs.stat(opts.lockfilePath);
    lockMtime = st.mtimeMs;
  } catch {
    /* lockfile missing — fall back to "no cache" by using 0 mtime */
  }
  const hit = cache.get(cacheKey);
  if (hit && hit.lockfileMtimeMs === lockMtime) return hit.records;
  const records = await loadIndexFromDisk(opts.packagesRoot, opts.scopes);
  cache.set(cacheKey, { lockfileMtimeMs: lockMtime, records });
  return records;
}

/** Clear the in-memory package index cache. Useful in tests. */
export function clearIndexCache(): void {
  cache.clear();
}

function normalise(breakdowns: ScoreBreakdown[]): number[] {
  const max = breakdowns.reduce((m, b) => (b.total > m ? b.total : m), 0);
  if (max === 0) return breakdowns.map(() => 0);
  return breakdowns.map((b) => b.total / max);
}

/** Rank a known set of records against a brief. Pure function — usable in tests. */
export function rankCandidates(brief: string, records: readonly PackageRecord[], topN: number): RankedCandidate[] {
  const terms = tokenize(brief);
  if (terms.length === 0 || records.length === 0) return [];
  const scored = records.map((r) => ({ rec: r, breakdown: scorePackage(terms, r) }));
  const norm = normalise(scored.map((s) => s.breakdown));
  const ranked = scored
    .map((s, i) => ({ rec: s.rec, breakdown: s.breakdown, score: norm[i] ?? 0 }))
    .filter((s) => s.breakdown.total > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  return ranked.map((s) => ({
    packageName: s.rec.packageName,
    description: s.rec.description,
    mainExports: s.rec.mainExports,
    matchScore: Number(s.score.toFixed(4)),
    matchReasons: buildReasons(s.breakdown, s.rec),
  }));
}

function buildReasons(b: ScoreBreakdown, r: PackageRecord): readonly string[] {
  const reasons: string[] = [];
  if (b.byField.name > 0) reasons.push(`term${b.matchedTerms.length === 1 ? "" : "s"} matched package name: ${b.matchedTerms.filter((t) => r.tokens.name.has(t)).join(", ")}`);
  if (b.byField.exports > 0) reasons.push(`matched export: ${b.matchedTerms.filter((t) => r.tokens.exports.has(t)).join(", ")}`);
  if (b.byField.keywords > 0) reasons.push(`matched keyword: ${b.matchedTerms.filter((t) => r.tokens.keywords.has(t)).join(", ")}`);
  if (b.byField.description > 0) reasons.push(`matched in description: ${b.matchedTerms.filter((t) => r.tokens.description.has(t)).join(", ")}`);
  return reasons;
}

/**
 * Search workspace packages for reuse candidates matching the brief.
 * Result is sorted descending by `matchScore` and truncated to `topN`.
 */
export async function searchReuseCandidates(brief: string, opts: SearchOptions = {}): Promise<RankedCandidate[]> {
  const topN = opts.topN ?? 10;
  if (opts.inMemoryPackages) {
    const records = opts.inMemoryPackages.map(buildRecord);
    return rankCandidates(brief, records, topN);
  }
  const packagesRoot = opts.packagesRoot ?? resolve(process.cwd(), "packages");
  const scopes = opts.scopes ?? DEFAULT_SCOPES;
  const lockfilePath = opts.lockfilePath ?? resolve(packagesRoot, "..", "pnpm-lock.yaml");
  const records = await getIndex({ packagesRoot, scopes, lockfilePath });
  return rankCandidates(brief, records, topN);
}

export { tokenize, scorePackage };
export type { PackageRecord, ScoreBreakdown };
