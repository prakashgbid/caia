#!/usr/bin/env node
// scripts/build_file_index.ts — one-shot index builder for the RAG layer.
//
// Walks ~/Documents/projects/caia/{packages,websites,scripts}/**/*.{ts,tsx,js,py,md},
// embeds each file's first 4K chars via Ollama nomic-embed-text, and writes
// the result to ~/.caia/router/file_index.json.
//
// Run:
//   pnpm tsx scripts/build_file_index.ts            # default paths
//   pnpm tsx scripts/build_file_index.ts --roots ../foo
//
// Or, after build:
//   node dist/scripts/build_file_index.js

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const DEFAULT_ROOTS = [
  join(homedir(), 'Documents/projects/caia/packages'),
  join(homedir(), 'Documents/projects/caia/websites'),
  join(homedir(), 'Documents/projects/caia/scripts'),
];
const REPO_ROOT = join(homedir(), 'Documents/projects/caia');

const ALLOWED_EXTS = new Set(['.ts', '.tsx', '.js', '.py', '.md']);
const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', '.next', '.turbo', '.cache',
  '__pycache__', '.venv', 'venv', '.git', 'coverage', '.spawn-worktrees',
]);

const EMBED_CHAR_CAP = 4_000;
const PREVIEW_CHARS = 256;
const OLLAMA_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env['ROUTER_RAG_EMBED_MODEL'] ?? 'nomic-embed-text';
const OUT_PATH = process.env['ROUTER_RAG_INDEX_PATH']
  ?? join(homedir(), '.caia', 'router', 'file_index.json');

interface CliArgs {
  roots: string[];
  out: string;
  limit: number;          // 0 = no limit; useful for fast smoke runs
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { roots: DEFAULT_ROOTS, out: OUT_PATH, limit: 0, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--roots' && i + 1 < argv.length) {
      const next = argv[++i];
      if (next !== undefined) out.roots = next.split(',').map(r => resolve(r));
    } else if (a === '--out' && i + 1 < argv.length) {
      const next = argv[++i];
      if (next !== undefined) out.out = next;
    } else if (a === '--limit' && i + 1 < argv.length) {
      const next = argv[++i];
      if (next !== undefined) out.limit = Number(next);
    } else if (a === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

function* walk(root: string): Generator<string> {
  if (!existsSync(root)) return;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: { name: string; isDir: boolean }[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map(d => ({
        name: d.name, isDir: d.isDirectory(),
      }));
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDir) {
        stack.push(full);
      } else {
        const dot = e.name.lastIndexOf('.');
        if (dot === -1) continue;
        const ext = e.name.slice(dot);
        if (!ALLOWED_EXTS.has(ext)) continue;
        yield full;
      }
    }
  }
}

async function embedOne(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`ollama embeddings returned ${res.status}`);
  }
  const body = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(body.embedding) || body.embedding.length === 0) {
    throw new Error('empty embedding returned');
  }
  return body.embedding;
}

interface IndexEntry {
  path: string;
  rel: string;
  size: number;
  preview: string;
  vector: number[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  // ─── collect ──────────────────────────────────────────────────────────
  const paths: string[] = [];
  for (const root of args.roots) {
    for (const p of walk(root)) paths.push(p);
  }
  paths.sort();
  const total = paths.length;
  // eslint-disable-next-line no-console
  console.error(`[index] collected ${total} candidate files from ${args.roots.length} root(s)`);

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.error('[index] dry-run — exiting after collection');
    return;
  }

  // ─── embed ────────────────────────────────────────────────────────────
  const entries: IndexEntry[] = [];
  let totalBytes = 0;
  let failures = 0;
  const limit = args.limit > 0 ? Math.min(args.limit, total) : total;

  for (let i = 0; i < limit; i++) {
    const p = paths[i];
    if (p === undefined) continue;
    let body: string;
    let size: number;
    try {
      body = readFileSync(p, 'utf8');
      size = statSync(p).size;
    } catch {
      failures += 1;
      continue;
    }
    if (body.trim().length === 0) continue;
    const truncated = body.slice(0, EMBED_CHAR_CAP);
    totalBytes += truncated.length;

    let vector: number[];
    try {
      vector = await embedOne(truncated);
    } catch (e) {
      failures += 1;
      // eslint-disable-next-line no-console
      console.error(`[index] ${i + 1}/${limit} FAIL ${relative(REPO_ROOT, p)}: ${(e as Error).message}`);
      continue;
    }

    entries.push({
      path: p,
      rel: relative(REPO_ROOT, p),
      size,
      preview: truncated.slice(0, PREVIEW_CHARS),
      vector,
    });

    if ((i + 1) % 50 === 0 || i + 1 === limit) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      // eslint-disable-next-line no-console
      console.error(`[index] ${i + 1}/${limit} embedded — ${entries.length} ok, ${failures} fail, ${elapsed}s elapsed`);
    }
  }

  // ─── write ────────────────────────────────────────────────────────────
  mkdirSync(dirname(args.out), { recursive: true });
  const doc = {
    version: 1 as const,
    model: EMBED_MODEL,
    dim: entries[0]?.vector.length ?? 0,
    built_at: new Date().toISOString(),
    entries,
  };
  writeFileSync(args.out, JSON.stringify(doc));
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  const sizeMB = (statSync(args.out).size / (1024 * 1024)).toFixed(2);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    out: args.out,
    files_indexed: entries.length,
    files_failed: failures,
    total_embed_bytes: totalBytes,
    elapsed_seconds: Number(elapsedSec),
    on_disk_mb: Number(sizeMB),
    dim: doc.dim,
    model: doc.model,
  }, null, 2));
}

main().catch(e => {
  // eslint-disable-next-line no-console
  console.error('[index] fatal:', (e as Error).message);
  process.exit(1);
});
