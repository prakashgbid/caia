/**
 * @caia/qa-engineer/test-strategy
 *
 * Resolves the e2e spec files authored by @caia/test-author + reviewed by
 * @caia/test-reviewer for a given ticket, and rewrites their effective
 * base URL to the production URL.
 *
 * Two strategies are supported:
 *
 *   1. Env-passthrough (default) — inject `PLAYWRIGHT_BASE_URL` into the
 *      adapter env so the spec files can pick it up via Playwright's
 *      `use.baseURL` resolution. No file mutation; the spec dir on disk
 *      is left untouched. Safe for shared specs that other stages also
 *      consume.
 *
 *   2. Out-of-tree rewrite — copy spec files into a scratch directory
 *      under `/tmp` and rewrite any literal `http://localhost:<port>`
 *      URLs to `productionUrl`. Used when the consumer can't or won't
 *      thread the env var (legacy specs with hard-coded localhost
 *      references).
 *
 * Both strategies preserve True-Zero: no real network during resolve.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  ProductionTarget,
  SpecResolution,
  SpecStrategy,
} from './types.js';

export interface DefaultSpecStrategyOptions {
  /**
   * Where the ticket-author + test-reviewer leave their e2e specs.
   * Conventionally `<repoRoot>/tickets/<ticketId>/tests/e2e`. Override
   * for tests / non-standard layouts.
   */
  readonly resolveSpecDir: (target: ProductionTarget) => string;
  /**
   * If true, copy the spec dir into a scratch dir under tmpRoot and
   * rewrite any literal localhost URLs. Default false (env-passthrough).
   */
  readonly rewriteInPlace?: boolean;
  /** Scratch directory root for the rewrite strategy. */
  readonly tmpRoot?: string;
  /**
   * FS adapter — defaults to node:fs/promises. Injected for tests.
   */
  readonly fsImpl?: FsAdapter;
}

/**
 * Subset of node:fs/promises that we depend on. Lets tests inject a
 * deterministic in-memory FS without touching disk.
 */
export interface FsAdapter {
  readdir(dir: string, opts: { withFileTypes: true }): Promise<ReadonlyArray<{ name: string; isFile(): boolean; isDirectory(): boolean }>>;
  readFile(p: string, enc: 'utf8'): Promise<string>;
  writeFile(p: string, data: string, enc: 'utf8'): Promise<void>;
  mkdir(p: string, opts: { recursive: true }): Promise<void>;
}

/**
 * Default node:fs adapter. Exported for callers that want to compose
 * their own strategy with the same defaults.
 */
export const NODE_FS_ADAPTER: FsAdapter = {
  readdir: (dir, opts) => fs.readdir(dir, opts) as Promise<ReadonlyArray<{ name: string; isFile(): boolean; isDirectory(): boolean }>>,
  readFile: (p, enc) => fs.readFile(p, enc),
  writeFile: (p, data, enc) => fs.writeFile(p, data, enc),
  mkdir: async (p, opts) => {
    await fs.mkdir(p, opts);
  },
};

/**
 * Build a {@link SpecStrategy} that resolves a ticket's e2e specs and
 * (optionally) rewrites them to point at the production URL.
 */
export function createDefaultSpecStrategy(
  opts: DefaultSpecStrategyOptions,
): SpecStrategy {
  const fsAdapter = opts.fsImpl ?? NODE_FS_ADAPTER;
  const rewriteInPlace = opts.rewriteInPlace ?? false;

  return {
    async resolveSpecs(target: ProductionTarget): Promise<SpecResolution> {
      const originalSpecDir = opts.resolveSpecDir(target);
      const specFiles = await listSpecFiles(originalSpecDir, fsAdapter);

      if (!rewriteInPlace) {
        return {
          specFiles,
          rewrittenSpecCount: 0,
          baseUrl: target.productionUrl,
          originalSpecDir,
        };
      }

      const tmpRoot = opts.tmpRoot ?? path.join('/tmp', 'caia-qa-engineer');
      const scratchDir = path.join(tmpRoot, target.ticketId, 'tests', 'e2e');
      await fsAdapter.mkdir(scratchDir, { recursive: true });

      let rewritten = 0;
      const rewrittenPaths: string[] = [];
      for (const src of specFiles) {
        const rel = path.relative(originalSpecDir, src);
        const dst = path.join(scratchDir, rel);
        await fsAdapter.mkdir(path.dirname(dst), { recursive: true });
        const source = await fsAdapter.readFile(src, 'utf8');
        const next = rewriteBaseUrl(source, target.productionUrl);
        await fsAdapter.writeFile(dst, next, 'utf8');
        if (next !== source) rewritten += 1;
        rewrittenPaths.push(dst);
      }

      return {
        specFiles: rewrittenPaths,
        rewrittenSpecCount: rewritten,
        baseUrl: target.productionUrl,
        originalSpecDir,
      };
    },
  };
}

/**
 * Walk a directory recursively and collect every `*.spec.ts` /
 * `*.spec.js` / `*.e2e.ts` Playwright spec file.
 */
export async function listSpecFiles(
  dir: string,
  fsAdapter: FsAdapter,
): Promise<ReadonlyArray<string>> {
  const out: string[] = [];
  await walk(dir, fsAdapter, out);
  return out.sort();
}

async function walk(
  dir: string,
  fsAdapter: FsAdapter,
  acc: string[],
): Promise<void> {
  let entries: ReadonlyArray<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
  try {
    entries = await fsAdapter.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, fsAdapter, acc);
    } else if (entry.isFile() && isSpecFile(entry.name)) {
      acc.push(full);
    }
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code: string }).code === 'ENOENT'
  );
}

/**
 * A file counts as a Playwright spec if it ends in `.spec.ts`, `.spec.js`,
 * `.e2e.ts`, or `.e2e.js`. Mirrors the Test Author Agent's emission
 * convention (`@caia/test-author` emits `.spec.ts` by default).
 */
export function isSpecFile(name: string): boolean {
  return (
    name.endsWith('.spec.ts')
    || name.endsWith('.spec.js')
    || name.endsWith('.e2e.ts')
    || name.endsWith('.e2e.js')
  );
}

/**
 * Rewrite literal `http://localhost:<port>` / `http://127.0.0.1:<port>` /
 * `http://0.0.0.0:<port>` URLs to `productionUrl`. Preserves path + query.
 *
 * Trailing slashes on `productionUrl` are normalised so we don't emit
 * `https://example.com//foo` on join.
 *
 * Idempotent: applying twice produces the same output.
 */
export function rewriteBaseUrl(
  source: string,
  productionUrl: string,
): string {
  const prod = stripTrailingSlash(productionUrl);
  return source.replace(
    /http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/g,
    prod,
  );
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') && url !== '/' ? url.slice(0, -1) : url;
}

// ─── Env-passthrough helper ─────────────────────────────────────────────────

/**
 * Build the env block the Playwright adapter should run with so specs
 * that read `process.env.PLAYWRIGHT_BASE_URL` (or use
 * `definePlaywrightConfig({ baseURL: process.env.PLAYWRIGHT_BASE_URL })`)
 * pick up the production URL. Also sets `CI=1`, `NODE_ENV=test`, and a
 * `CAIA_QA_ENGINEER_TICKET_ID` label for tracing.
 */
export function buildPlaywrightEnv(
  target: ProductionTarget,
  base: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    ...base,
    CI: '1',
    NODE_ENV: 'test',
    PLAYWRIGHT_BASE_URL: stripTrailingSlash(target.productionUrl),
    CAIA_QA_ENGINEER_TICKET_ID: target.ticketId,
    CAIA_QA_ENGINEER_PROJECT_ID: target.projectId,
  };
}
