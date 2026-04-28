import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MANIFEST_PATH = resolve(__dirname, '../../manifest/images.json');

const StorageVariantsSchema = z.object({
  mobile: z.string(),
  tablet: z.string(),
  desktop: z.string(),
  '4k': z.string(),
  original: z.string(),
});

export const ImageRecordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  query: z.string(),
  source: z.object({
    kind: z.enum(['web', 'ai']),
    provider: z.string(),
    sourceUrl: z.string().optional(),
    model: z.string().optional(),
  }),
  license: z.object({
    name: z.string(),
    url: z.string().optional(),
    attributionRequired: z.boolean(),
    photographer: z.string().optional(),
    photographerUrl: z.string().optional(),
  }),
  storage: z.object({
    backend: z.string(),
    baseUrl: z.string(),
    variants: StorageVariantsSchema,
  }),
  alt: z.string(),
  tags: z.array(z.string()),
  validation: z.object({
    relevance: z.number(),
    sharpness: z.number(),
    aesthetic: z.number().optional(),
    aiDetection: z.number().optional(),
  }),
  usages: z.array(z.object({
    site: z.string(),
    slot: z.string(),
    addedAt: z.string(),
  })),
  cost: z.number(),
  // L-13: per-site deduplication
  site: z.enum(['poker-zeno', 'roulette-community']).optional(),
  contentHash: z.string().optional(), // sha256 of first 4KB of image buffer, hex
  // Media kind — defaults to 'image' when absent (backward-compatible)
  kind: z.enum(['image', 'video', 'gif']).optional(),
  // Duration in seconds — only relevant for video/gif records
  duration: z.number().optional(),
});

export type ImageRecord = z.infer<typeof ImageRecordSchema>;
export type ImageUsage = ImageRecord['usages'][number];

function readManifest(): ImageRecord[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  try {
    const raw = readFileSync(MANIFEST_PATH, 'utf-8');
    return z.array(ImageRecordSchema).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeManifest(records: ImageRecord[]): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(records, null, 2) + '\n', 'utf-8');
}

export function getAllImages(): ImageRecord[] {
  return readManifest();
}

export function getImageById(id: string): ImageRecord | null {
  return readManifest().find(r => r.id === id) ?? null;
}

export function addImage(record: ImageRecord): void {
  const records = readManifest();
  const existing = records.findIndex(r => r.id === record.id);
  if (existing >= 0) {
    records[existing] = record;
  } else {
    records.push(record);
  }
  writeManifest(records);
}

export function appendUsage(imageId: string, usage: ImageUsage): ImageRecord | null {
  const records = readManifest();
  const idx = records.findIndex(r => r.id === imageId);
  if (idx < 0) return null;
  const rec = records[idx]!;
  const alreadyExists = rec.usages.some(
    u => u.site === usage.site && u.slot === usage.slot,
  );
  if (!alreadyExists) {
    rec.usages.push(usage);
    writeManifest(records);
  }
  return rec;
}

export function getImagesBySite(site: string): ImageRecord[] {
  return readManifest().filter(r => r.usages.some(u => u.site === site));
}

export function findSimilarByQuery(query: string, threshold = 0.7): ImageRecord | null {
  const queryWords = new Set(
    query.toLowerCase().split(/\W+/).filter(w => w.length > 2),
  );
  if (queryWords.size === 0) return null;

  const records = readManifest();
  let best: { record: ImageRecord; score: number } | null = null;

  for (const record of records) {
    const recWords = new Set(
      record.query.toLowerCase().split(/\W+/).filter(w => w.length > 2),
    );
    const intersection = [...queryWords].filter(w => recWords.has(w)).length;
    const union = new Set([...queryWords, ...recWords]).size;
    const score = union > 0 ? intersection / union : 0;
    if (score >= threshold && (!best || score > best.score)) {
      best = { record, score };
    }
  }

  return best?.record ?? null;
}

export function generateId(query: string): string {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug}-${suffix}`;
}
