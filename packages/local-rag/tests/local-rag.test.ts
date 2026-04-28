import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalRag } from '../src/index.js';

const ORIGINAL_FETCH = globalThis.fetch;

let tmpdir: string;
let dbPath: string;
let repoRoot: string;

function mockEmbedderToReturnPathHash(): void {
  // Bag-of-words mock: the embedding is a sparse 64-dim vector where each
  // dimension counts hashed tokens. Texts that share tokens have similar
  // vectors; texts that don't are approximately orthogonal — enough for
  // ordering assertions without needing a real embedding model.
  globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as { prompt: string })
        : { prompt: '' };
    const prompt = (body.prompt ?? '').toLowerCase();
    const e = new Array<number>(64).fill(0);
    const tokens = prompt.split(/[^a-z0-9]+/).filter(Boolean);
    for (const t of tokens) {
      let h = 0;
      for (let i = 0; i < t.length; i++) {
        h = (h * 31 + t.charCodeAt(i)) & 0xffff;
      }
      e[h % 64]! += 1;
    }
    return {
      ok: true,
      json: async () => ({ embedding: e }),
    } as Response;
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-rag-int-'));
  dbPath = path.join(tmpdir, 'index.db');
  repoRoot = path.join(tmpdir, 'repo');
  fs.mkdirSync(repoRoot);
  mockEmbedderToReturnPathHash();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe('LocalRag', () => {
  it('indexes a directory and reports counts', async () => {
    fs.writeFileSync(
      path.join(repoRoot, 'a.ts'),
      Array.from({ length: 30 }, (_, i) => `function fn${i}() {}`).join('\n'),
    );
    fs.writeFileSync(
      path.join(repoRoot, 'b.md'),
      '# Heading\nSome documentation lines.\n',
    );
    fs.writeFileSync(path.join(repoRoot, 'ignored.png'), 'binary');

    const rag = new LocalRag({ dbPath });
    const result = await rag.indexDirectory(repoRoot);

    expect(result.files).toBe(2);
    expect(result.chunks).toBeGreaterThan(0);
    expect(rag.size()).toBe(result.chunks);
    rag.close();
  });

  it('skips standard exclude directories (node_modules etc)', async () => {
    const moduleDir = path.join(repoRoot, 'node_modules', 'pkg');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'index.ts'), 'export {}\n');
    fs.writeFileSync(path.join(repoRoot, 'real.ts'), 'export const x = 1;\n');

    const rag = new LocalRag({ dbPath });
    const result = await rag.indexDirectory(repoRoot);
    expect(result.files).toBe(1);
    rag.close();
  });

  it('skips files larger than maxFileBytes', async () => {
    fs.writeFileSync(path.join(repoRoot, 'big.ts'), 'a'.repeat(500_000));
    fs.writeFileSync(
      path.join(repoRoot, 'small.ts'),
      'export const x = 1;',
    );
    const rag = new LocalRag({ dbPath });
    const result = await rag.indexDirectory(repoRoot, { maxFileBytes: 1_000 });
    expect(result.files).toBe(1);
    rag.close();
  });

  it('re-indexing replaces chunks for changed files (idempotent)', async () => {
    const filePath = path.join(repoRoot, 'a.ts');
    fs.writeFileSync(filePath, 'export const x = 1;\nexport const y = 2;\n');
    const rag = new LocalRag({ dbPath });
    const first = await rag.indexDirectory(repoRoot);

    fs.writeFileSync(filePath, 'export const x = 1;\n');
    const second = await rag.indexDirectory(repoRoot);

    expect(rag.size()).toBe(second.chunks);
    expect(first.chunks).toBeGreaterThanOrEqual(second.chunks);
    rag.close();
  });

  it('query returns hits ordered by similarity', async () => {
    fs.writeFileSync(
      path.join(repoRoot, 'auth.ts'),
      'function signInWithEmail(email: string) {}\n',
    );
    fs.writeFileSync(
      path.join(repoRoot, 'cart.ts'),
      'function addToCart(productId: string) {}\n',
    );
    fs.writeFileSync(
      path.join(repoRoot, 'theme.md'),
      '# Theme\nColor tokens for the dashboard.\n',
    );

    const rag = new LocalRag({ dbPath });
    await rag.indexDirectory(repoRoot);
    const hits = await rag.query('signInWithEmail', { topK: 3, minScore: -1 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.path).toBe('auth.ts');
    rag.close();
  });

  it('reports embed progress during indexing', async () => {
    fs.writeFileSync(
      path.join(repoRoot, 'a.ts'),
      Array.from({ length: 200 }, (_, i) => `// line ${i}`).join('\n'),
    );

    const rag = new LocalRag({ dbPath });
    const events: string[] = [];
    await rag.indexDirectory(repoRoot, {}, (e) => {
      events.push(e.kind);
    });
    expect(events).toContain('files');
    expect(events).toContain('chunks');
    expect(events.filter((k) => k === 'embed').length).toBeGreaterThan(0);
    rag.close();
  });

  it('refuses to mix embedding models on the same index', async () => {
    fs.writeFileSync(path.join(repoRoot, 'a.ts'), 'export {};\n');
    const first = new LocalRag({
      dbPath,
      embedder: { model: 'nomic-embed-text' },
    });
    await first.indexDirectory(repoRoot);
    first.close();

    expect(
      () =>
        new LocalRag({
          dbPath,
          embedder: { model: 'mxbai-embed-large' },
        }),
    ).toThrow(/embedding model/);
  });
});
