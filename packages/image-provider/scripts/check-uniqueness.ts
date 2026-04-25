#!/usr/bin/env tsx
/**
 * check-uniqueness.ts — L-13 validation sweep
 *
 * Reads source files from poker-zeno and roulette-community, extracts image IDs,
 * and flags any image ID that appears in more than one distinct logical slot per site.
 *
 * Usage:  tsx scripts/check-uniqueness.ts
 * Exit:   0 = clean, 1 = duplicates found
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { glob } from 'glob';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlotOccurrence {
  file: string;
  /** attribute value, e.g. the full src string or the R2 image ID */
  rawValue: string;
}

interface SiteReport {
  site: string;
  duplicates: Array<{
    imageId: string;
    slots: string[];
  }>;
}

interface Report {
  generatedAt: string;
  clean: boolean;
  sites: SiteReport[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../..');

const SITES: Array<{ name: 'poker-zeno' | 'roulette-community'; srcGlob: string }> = [
  {
    name: 'poker-zeno',
    srcGlob: `${REPO_ROOT}/poker-zeno/src/**/*.tsx`,
  },
  {
    name: 'roulette-community',
    srcGlob: `${REPO_ROOT}/roulette-community/src/**/*.tsx`,
  },
];

// ─── Extraction helpers ───────────────────────────────────────────────────────

/**
 * Extract all image src values and R2 image IDs from a TSX file's raw text.
 *
 * We capture:
 *  - src="..." or src={...} attributes on <img> and <Image> elements
 *  - R2 image IDs (UUIDs / slug-style IDs in strings that look like image-provider IDs)
 */
function extractImageRefs(content: string): string[] {
  const refs: string[] = [];

  // src="..." — plain string src attributes
  for (const m of content.matchAll(/src=["']([^"']+)["']/g)) {
    refs.push(m[1]!);
  }

  // src={...} — dynamic src (capture the inner expression as-is for ID extraction)
  for (const m of content.matchAll(/src=\{([^}]+)\}/g)) {
    refs.push(m[1]!.trim());
  }

  return refs;
}

/**
 * Attempt to extract a canonical image-provider image ID from a raw src value.
 *
 * Image-provider IDs follow the pattern: <slug>-<4-char-random>
 * e.g. "poker-chips-stack-ab3f", "roulette-wheel-night-d2c1"
 *
 * We also accept R2 URLs that contain such an ID in their path.
 */
function extractImageId(raw: string): string | null {
  // Strip leading/trailing whitespace and quotes from dynamic expressions
  const cleaned = raw.replace(/^['"`]|['"`]$/g, '').trim();

  // Full URL: extract the last path segment before any query string
  let candidate = cleaned;
  try {
    const u = new URL(cleaned);
    const parts = u.pathname.split('/').filter(Boolean);
    candidate = parts[parts.length - 1] ?? cleaned;
  } catch {
    // Not a URL — treat cleaned as-is
  }

  // Remove known file extensions
  candidate = candidate.replace(/\.(jpg|jpeg|png|webp|avif|gif|mp4|mov|webm)$/i, '');

  // Must look like an image-provider ID: letters/numbers/hyphens ending with -<4hex/alphanum>
  if (/^[a-z0-9-]{5,}-[a-z0-9]{4}$/.test(candidate)) {
    return candidate;
  }

  // Also accept UUID-style IDs
  if (/^[0-9a-f-]{32,}$/.test(candidate)) {
    return candidate;
  }

  return null;
}

// ─── Per-file slot name ───────────────────────────────────────────────────────

/**
 * Derive a logical slot name from a file path.
 *
 * Two images in the same file count as the same slot (intentional reuse
 * within a component is fine — only cross-component duplication is flagged).
 */
function slotName(filePath: string, repoRoot: string): string {
  return relative(repoRoot, filePath);
}

// ─── Core logic ───────────────────────────────────────────────────────────────

async function checkSite(
  siteName: 'poker-zeno' | 'roulette-community',
  srcGlob: string,
  repoRoot: string,
): Promise<SiteReport> {
  const siteRoot = resolve(repoRoot, siteName);
  if (!existsSync(siteRoot)) {
    process.stderr.write(`  ⚠ ${siteName}: directory not found at ${siteRoot}, skipping\n`);
    return { site: siteName, duplicates: [] };
  }

  const files = await glob(srcGlob, { nodir: true });

  // imageId → Set of slot names (file paths)
  const imageSlots = new Map<string, Set<string>>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const refs = extractImageRefs(content);
    const slot = slotName(file, repoRoot);

    for (const ref of refs) {
      const id = extractImageId(ref);
      if (!id) continue;

      if (!imageSlots.has(id)) {
        imageSlots.set(id, new Set());
      }
      imageSlots.get(id)!.add(slot);
    }
  }

  const duplicates: SiteReport['duplicates'] = [];

  for (const [imageId, slots] of imageSlots) {
    if (slots.size > 1) {
      duplicates.push({ imageId, slots: [...slots].sort() });
    }
  }

  return { site: siteName, duplicates };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const siteReports = await Promise.all(
    SITES.map(s => checkSite(s.name, s.srcGlob, REPO_ROOT)),
  );

  const anyDuplicate = siteReports.some(r => r.duplicates.length > 0);

  const report: Report = {
    generatedAt: new Date().toISOString(),
    clean: !anyDuplicate,
    sites: siteReports,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  if (anyDuplicate) {
    process.stderr.write('\n❌ Duplicate image IDs found — see JSON report above.\n');
    process.exit(1);
  } else {
    process.stderr.write('\n✅ No cross-slot image duplicates found.\n');
    process.exit(0);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(2);
});
