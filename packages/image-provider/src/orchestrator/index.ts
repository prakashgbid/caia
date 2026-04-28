import { createHash } from 'crypto';
import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import pc from 'picocolors';
import { searchAllSources, type SourceImage } from '../sources/index.js';
import { validateImage, type ValidationResult } from '../validation/index.js';
import { generate } from '../generators/index.js';
import { getStorage } from '../storage/index.js';
import {
  addImage,
  appendUsage,
  findSimilarByQuery,
  generateId,
  getAllImages,
  type ImageRecord,
} from '../manifest/index.js';
import { containsMinor } from '../validators/age-safety.js';

// ─── L-13: Content hash for per-site deduplication ──────────────────────────

/** sha256 of the first 4 KB of a buffer — fast enough for large images. */
export function quickHash(buf: Buffer): string {
  return createHash('sha256').update(buf.subarray(0, 4096)).digest('hex');
}

/** Build a Set of contentHashes already stored for a given site. */
function siteHashSet(site: string): Set<string> {
  const records = getAllImages();
  const hashes = new Set<string>();
  for (const r of records) {
    if (r.site === site && r.contentHash) {
      hashes.add(r.contentHash);
    }
  }
  return hashes;
}

function logDuplicateRejection(candidateId: string, site: string, hash: string): void {
  const dir = join(homedir(), '.image-provider');
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, 'rejected-age-safety.jsonl'),
      JSON.stringify({
        id: candidateId,
        reason: 'duplicate-per-site',
        site,
        contentHash: hash,
        timestamp: new Date().toISOString(),
      }) + '\n',
      'utf-8',
    );
  } catch {
    // Non-fatal
  }
}

export interface AcquireOptions {
  query: string;
  site: 'poker-zeno' | 'roulette-community';
  slot: string;
  isHero: boolean;
  dryRun?: boolean;
}

export interface AcquireResult {
  record: ImageRecord;
  reused: boolean;
  source: 'manifest' | 'web' | 'ai';
}

export interface AcquireVideoOptions {
  query: string;
  site: 'poker-zeno' | 'roulette-community';
  slot: string;
  dryRun?: boolean;
}

export async function acquire(opts: AcquireOptions): Promise<AcquireResult> {
  const { query, site, slot, isHero, dryRun = false } = opts;

  // Step 1: Check manifest for similar intent (keyword Jaccard similarity ≥ 0.7)
  console.log(pc.cyan('→ Checking manifest for existing similar images…'));
  const existing = findSimilarByQuery(query);
  if (existing) {
    console.log(pc.green(`  ✔ Reusing existing image: ${existing.id}`));
    if (!dryRun) {
      appendUsage(existing.id, { site, slot, addedAt: new Date().toISOString() });
    }
    return { record: existing, reused: true, source: 'manifest' };
  }

  // Step 2: Search web sources in parallel
  console.log(pc.cyan('→ Searching web sources in parallel…'));
  const webCandidates = await searchAllSources(query, 20);
  console.log(pc.gray(`  Found ${webCandidates.length} candidates from web sources`));

  // Step 3: Download and validate web candidates (includes age-safety + per-site dedup)
  const webResults = await validateCandidates(webCandidates, query, site);
  if (webResults.winner) {
    const record = await storeAndRecord(webResults.winner, query, site, slot, dryRun);
    return { record, reused: false, source: 'web' };
  }

  // Step 4: AI generation fallback
  console.log(pc.cyan(`→ No web candidate passed. Generating via fal.ai (hero=${isHero})…`));
  const aiRecord = await tryAiGeneration(query, isHero, site, slot, dryRun);
  if (aiRecord) {
    return { record: aiRecord, reused: false, source: 'ai' };
  }

  // Step 5: Manual fallback — show top 3 and ask user to pick
  return pickManually(webResults.all, query, site, slot, dryRun);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface CandidateResult {
  candidate: SourceImage;
  buffer: Buffer;
  validation: ValidationResult;
  contentHash: string;
}

async function validateCandidates(
  candidates: SourceImage[],
  query: string,
  site: 'poker-zeno' | 'roulette-community',
): Promise<{ winner: CandidateResult | null; all: CandidateResult[] }> {
  const results: CandidateResult[] = [];
  let winner: CandidateResult | null = null;

  // L-13: build a hash-set of images already stored for this site
  const existingHashes = siteHashSet(site);

  for (const candidate of candidates.slice(0, 20)) {
    try {
      process.stdout.write(pc.gray(`  Checking ${candidate.id}… `));
      const buffer = await downloadImage(candidate.url);

      // Age-safety check: non-bypassable gate before any other validation
      const ageSafety = await containsMinor(buffer, {
        alt: candidate.alt,
        description: candidate.alt,
      });
      if (ageSafety !== 'clear') {
        console.log(pc.red(`✗ age-safety rejected (${ageSafety})`));
        continue;
      }

      // L-13: per-site uniqueness check
      const hash = quickHash(buffer);
      if (existingHashes.has(hash)) {
        console.log(pc.yellow(`✗ duplicate-per-site (hash=${hash.slice(0, 12)}…)`));
        logDuplicateRejection(candidate.id, site, hash);
        continue;
      }

      const validation = await validateImage(buffer, query);
      results.push({ candidate, buffer, validation, contentHash: hash });

      if (validation.passed) {
        console.log(pc.green(`✔ (rel=${validation.relevance.toFixed(2)}, sharp=${validation.sharpness.toFixed(0)})`));
        winner = { candidate, buffer, validation, contentHash: hash };
        break;
      } else {
        console.log(pc.gray(`✗ ${validation.reasons[0] ?? 'failed'}`));
      }
    } catch (err) {
      console.log(pc.red(`✗ error: ${err instanceof Error ? err.message : err}`));
    }
  }

  results.sort((a, b) => b.validation.relevance - a.validation.relevance);
  return { winner, all: results };
}

async function downloadImage(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed ${resp.status}: ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function tryAiGeneration(
  query: string,
  isHero: boolean,
  site: 'poker-zeno' | 'roulette-community',
  slot: string,
  dryRun: boolean,
): Promise<ImageRecord | null> {
  try {
    const generated = await generate({ query, isHero, count: 4 });
    const aiCandidates: SourceImage[] = generated.map((g, i) => ({
      id: `ai-gen-${i}`,
      url: g.url,
      previewUrl: g.url,
      width: 3840,
      height: 2160,
      alt: query,
      license: {
        name: isHero ? 'FLUX.1-pro Commercial License' : 'FLUX.1-schnell Commercial License',
        url: 'https://blackforestlabs.ai/flux-1-pro-commercial-license/',
        attributionRequired: false,
      },
      provider: g.model,
      sourceUrl: g.url,
    }));

    const aiResults = await validateCandidates(aiCandidates, query, site);
    if (aiResults.winner) {
      return storeAndRecord(aiResults.winner, query, site, slot, dryRun);
    }
    return null;
  } catch (err) {
    console.error(pc.red(`  AI generation failed: ${err instanceof Error ? err.message : err}`));
    return null;
  }
}

async function storeAndRecord(
  result: CandidateResult,
  query: string,
  site: 'poker-zeno' | 'roulette-community',
  slot: string,
  dryRun: boolean,
  mediaKind: 'image' | 'video' = 'image',
): Promise<ImageRecord> {
  const { candidate, buffer, validation, contentHash } = result;
  const id = generateId(query);
  const isAi = candidate.provider.includes('fal-ai') || candidate.provider.includes('flux');

  const source: ImageRecord['source'] = isAi
    ? { kind: 'ai', provider: candidate.provider, model: candidate.provider }
    : { kind: 'web', provider: candidate.provider, sourceUrl: candidate.sourceUrl };

  const cost = isAi
    ? candidate.provider.includes('flux-pro') ? 0.05 : 0.003
    : 0;

  const emptyVariants = { mobile: '', tablet: '', desktop: '', '4k': '', original: '' };
  let storageInfo = { baseUrl: '', variants: emptyVariants };

  if (!dryRun) {
    const storage = await getStorage();
    storageInfo = await storage.upload(buffer, id, { alt: candidate.alt, query, site });
  }

  const record: ImageRecord = {
    id,
    createdAt: new Date().toISOString(),
    query,
    source,
    license: candidate.license,
    storage: {
      backend: dryRun ? 'none' : 'r2',
      baseUrl: storageInfo.baseUrl,
      variants: storageInfo.variants,
    },
    alt: candidate.alt,
    tags: query.toLowerCase().split(/\W+/).filter(w => w.length > 2),
    validation: {
      relevance: validation.relevance,
      sharpness: validation.sharpness,
      aesthetic: validation.aesthetic,
      aiDetection: validation.aiDetection,
    },
    usages: [{ site, slot, addedAt: new Date().toISOString() }],
    cost,
    // L-13: store site + content hash for per-site deduplication
    site,
    contentHash,
    kind: mediaKind,
  };

  if (!dryRun) {
    addImage(record);
  }

  return record;
}

async function pickManually(
  candidates: CandidateResult[],
  query: string,
  site: 'poker-zeno' | 'roulette-community',
  slot: string,
  dryRun: boolean,
): Promise<AcquireResult> {
  const top3 = candidates.slice(0, 3);

  if (top3.length === 0) {
    throw new Error('No candidates found from any source. Try a different query.');
  }

  console.log(pc.yellow('\n  No candidate passed validation. Top 3 candidates:\n'));
  top3.forEach((c, i) => {
    console.log(`  [${i}] ${c.candidate.id} (${c.candidate.provider})`);
    console.log(`      Preview: ${c.candidate.previewUrl}`);
    console.log(`      Relevance: ${c.validation.relevance.toFixed(3)}  Sharpness: ${c.validation.sharpness.toFixed(1)}`);
    if (c.validation.reasons.length > 0) {
      console.log(`      Issues: ${c.validation.reasons.join(', ')}`);
    }
    console.log('');
  });

  if (dryRun) {
    throw new Error('Dry run: no passing candidate found. Review the candidates above.');
  }

  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve =>
    rl.question('Pick index (0/1/2) or q to quit: ', resolve),
  );
  rl.close();

  if (answer.toLowerCase() === 'q') {
    throw new Error('Acquisition cancelled by user.');
  }

  const idx = parseInt(answer, 10);
  const chosen = top3[idx];
  if (!chosen) throw new Error(`Invalid choice: "${answer}"`);

  const record = await storeAndRecord(chosen, query, site, slot, dryRun);
  return { record, reused: false, source: 'web' };
}

// ─── L-13: Video acquisition ─────────────────────────────────────────────────

/**
 * Acquire a video for a site slot.
 *
 * Searches pexels-video, coverr, and mixkit (all free / royalty-free sources).
 * Runs the same age-safety + per-site uniqueness checks as `acquire()`.
 * Stores the result under `kind: 'video'` in the manifest.
 */
export async function acquireVideo(opts: AcquireVideoOptions): Promise<AcquireResult> {
  const { query, site, slot, dryRun = false } = opts;

  console.log(pc.cyan('→ Searching video sources (pexels-video, coverr, mixkit)…'));

  // Attempt each video source in order of quality/reliability
  const videoSources = [
    searchPexelsVideo,
    searchCoverrVideo,
    searchMixkitVideo,
  ];

  let allCandidates: SourceImage[] = [];
  for (const searchFn of videoSources) {
    try {
      const results = await searchFn(query, 10);
      allCandidates = allCandidates.concat(results);
    } catch (err) {
      console.error(pc.yellow(`  ⚠ Video source failed: ${err instanceof Error ? err.message : err}`));
    }
  }

  console.log(pc.gray(`  Found ${allCandidates.length} video candidates`));

  if (allCandidates.length === 0) {
    throw new Error(`No video candidates found for query: "${query}". Try a different query.`);
  }

  const results = await validateCandidates(allCandidates, query, site);

  if (!results.winner) {
    throw new Error(`No video candidate passed age-safety + uniqueness checks for query: "${query}".`);
  }

  const record = await storeAndRecord(results.winner, query, site, slot, dryRun, 'video');
  return { record, reused: false, source: 'web' };
}

// ─── Video source stubs (royalty-free: pexels-video, coverr, mixkit) ─────────

async function searchPexelsVideo(query: string, perPage: number): Promise<SourceImage[]> {
  const apiKey = process.env['PEXELS_API_KEY'];
  if (!apiKey) {
    console.warn(pc.yellow('  ⚠ PEXELS_API_KEY not set — skipping pexels-video'));
    return [];
  }

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&size=medium`;
  const resp = await fetch(url, { headers: { Authorization: apiKey } });
  if (!resp.ok) throw new Error(`Pexels video API error: ${resp.status}`);

  const data = await resp.json() as {
    videos?: Array<{
      id: number;
      url: string;
      width: number;
      height: number;
      duration: number;
      user: { name: string; url: string };
      video_files: Array<{ quality: string; link: string; width: number; height: number }>;
    }>;
  };

  return (data.videos ?? []).map(v => {
    const hd = v.video_files.find(f => f.quality === 'hd') ?? v.video_files[0];
    return {
      id: `pexels-video-${v.id}`,
      url: hd?.link ?? v.url,
      previewUrl: v.url,
      width: hd?.width ?? v.width,
      height: hd?.height ?? v.height,
      alt: query,
      license: {
        name: 'Pexels License',
        url: 'https://www.pexels.com/license/',
        attributionRequired: false,
        photographer: v.user.name,
        photographerUrl: v.user.url,
      },
      provider: 'pexels-video',
      sourceUrl: v.url,
    } satisfies SourceImage;
  });
}

async function searchCoverrVideo(query: string, perPage: number): Promise<SourceImage[]> {
  // Coverr v3 API is public and free — no key required
  const url = `https://api.coverr.co/videos?query=${encodeURIComponent(query)}&page=1&per_page=${perPage}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Coverr API error: ${resp.status}`);

  const data = await resp.json() as {
    hits?: Array<{
      id: string;
      url: string;
      width: number;
      height: number;
      duration: number;
      urls: { mp4_download?: string };
    }>;
  };

  return (data.hits ?? []).map(v => ({
    id: `coverr-${v.id}`,
    url: v.urls.mp4_download ?? v.url,
    previewUrl: v.url,
    width: v.width,
    height: v.height,
    alt: query,
    license: {
      name: 'Coverr Free License',
      url: 'https://coverr.co/license',
      attributionRequired: false,
    },
    provider: 'coverr',
    sourceUrl: v.url,
  }) satisfies SourceImage);
}

async function searchMixkitVideo(query: string, _perPage: number): Promise<SourceImage[]> {
  // Mixkit does not provide a public search API — return empty to avoid 404 noise.
  // Callers can integrate Mixkit via their internal scraping / RSS feed if desired.
  console.warn(pc.yellow('  ⚠ Mixkit has no public API — skipping mixkit source'));
  void query;
  return [];
}
