import { describe, it, expect } from 'vitest';

import {
  rewriteBaseUrl,
  stripTrailingSlash,
  isSpecFile,
  buildPlaywrightEnv,
  listSpecFiles,
  createDefaultSpecStrategy,
  type FsAdapter,
} from '../src/test-strategy.js';
import type { ProductionTarget } from '../src/types.js';

const target = (overrides: Partial<ProductionTarget> = {}): ProductionTarget => ({
  ticketId: 'T-100',
  projectId: 'P-1',
  productionUrl: 'https://app.example.com',
  packageName: '@caia/example',
  ...overrides,
});

class InMemoryFs implements FsAdapter {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  set(p: string, content: string): void {
    this.files.set(p, content);
    let cur = p;
    while (cur !== '/' && cur !== '.') {
      cur = cur.substring(0, cur.lastIndexOf('/')) || '/';
      this.dirs.add(cur);
    }
  }
  setDir(p: string): void { this.dirs.add(p); }
  get(p: string): string | undefined { return this.files.get(p); }
  has(p: string): boolean { return this.files.has(p); }

  async readdir(dir: string, _opts: { withFileTypes: true }) {
    const direct = new Map<string, { isFile: boolean; isDirectory: boolean }>();
    for (const f of this.files.keys()) {
      if (f.startsWith(dir + '/')) {
        const rel = f.substring(dir.length + 1);
        const seg = rel.split('/')[0]!;
        if (rel === seg) direct.set(seg, { isFile: true, isDirectory: false });
        else if (!direct.has(seg)) direct.set(seg, { isFile: false, isDirectory: true });
      }
    }
    if (direct.size === 0 && !this.dirs.has(dir)) {
      const err = new Error('ENOENT') as Error & { code: string };
      err.code = 'ENOENT';
      throw err;
    }
    return Array.from(direct.entries()).map(([name, kind]) => ({
      name,
      isFile: () => kind.isFile,
      isDirectory: () => kind.isDirectory,
    }));
  }
  async readFile(p: string, _enc: 'utf8'): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) {
      const err = new Error('ENOENT') as Error & { code: string };
      err.code = 'ENOENT';
      throw err;
    }
    return v;
  }
  async writeFile(p: string, data: string, _enc: 'utf8'): Promise<void> {
    this.files.set(p, data);
  }
  async mkdir(p: string, _opts: { recursive: true }): Promise<void> {
    this.dirs.add(p);
  }
}

describe('stripTrailingSlash', () => {
  it('strips a single trailing slash', () => {
    expect(stripTrailingSlash('https://x/')).toBe('https://x');
  });
  it('leaves a non-trailing-slash URL alone', () => {
    expect(stripTrailingSlash('https://x')).toBe('https://x');
  });
  it('does not strip a bare "/"', () => {
    expect(stripTrailingSlash('/')).toBe('/');
  });
});

describe('rewriteBaseUrl', () => {
  it('rewrites http://localhost:PORT', () => {
    const out = rewriteBaseUrl('await page.goto("http://localhost:3000/login")', 'https://app.example.com');
    expect(out).toBe('await page.goto("https://app.example.com/login")');
  });
  it('rewrites 127.0.0.1', () => {
    const out = rewriteBaseUrl('fetch("http://127.0.0.1:8080/api")', 'https://app.example.com');
    expect(out).toBe('fetch("https://app.example.com/api")');
  });
  it('rewrites 0.0.0.0', () => {
    const out = rewriteBaseUrl('"http://0.0.0.0:5000"', 'https://app.example.com');
    expect(out).toBe('"https://app.example.com"');
  });
  it('rewrites localhost without a port', () => {
    const out = rewriteBaseUrl('"http://localhost/x"', 'https://app.example.com');
    expect(out).toBe('"https://app.example.com/x"');
  });
  it('is idempotent', () => {
    const once = rewriteBaseUrl('"http://localhost:3000/x"', 'https://app.example.com');
    const twice = rewriteBaseUrl(once, 'https://app.example.com');
    expect(once).toBe(twice);
  });
  it('strips trailing slash on production URL', () => {
    const out = rewriteBaseUrl('"http://localhost:3000/x"', 'https://app.example.com/');
    expect(out).toBe('"https://app.example.com/x"');
  });
  it('leaves non-localhost https URLs alone', () => {
    const src = '"https://other.com:3000/x"';
    expect(rewriteBaseUrl(src, 'https://app.example.com')).toBe(src);
  });
});

describe('isSpecFile', () => {
  it('recognises .spec.ts', () => { expect(isSpecFile('login.spec.ts')).toBe(true); });
  it('recognises .spec.js', () => { expect(isSpecFile('login.spec.js')).toBe(true); });
  it('recognises .e2e.ts', () => { expect(isSpecFile('login.e2e.ts')).toBe(true); });
  it('recognises .e2e.js', () => { expect(isSpecFile('login.e2e.js')).toBe(true); });
  it('rejects bare .ts', () => { expect(isSpecFile('login.ts')).toBe(false); });
  it('rejects fixtures', () => { expect(isSpecFile('fixtures.json')).toBe(false); });
});

describe('buildPlaywrightEnv', () => {
  it('injects PLAYWRIGHT_BASE_URL stripped of trailing slash', () => {
    const env = buildPlaywrightEnv(target({ productionUrl: 'https://app.example.com/' }));
    expect(env['PLAYWRIGHT_BASE_URL']).toBe('https://app.example.com');
  });
  it('sets CI=1 and NODE_ENV=test', () => {
    const env = buildPlaywrightEnv(target());
    expect(env['CI']).toBe('1');
    expect(env['NODE_ENV']).toBe('test');
  });
  it('labels ticket + project IDs', () => {
    const env = buildPlaywrightEnv(target({ ticketId: 'T-77', projectId: 'P-9' }));
    expect(env['CAIA_QA_ENGINEER_TICKET_ID']).toBe('T-77');
    expect(env['CAIA_QA_ENGINEER_PROJECT_ID']).toBe('P-9');
  });
  it('preserves caller-provided base env', () => {
    const env = buildPlaywrightEnv(target(), { CUSTOM: 'hello' });
    expect(env['CUSTOM']).toBe('hello');
  });
});

describe('listSpecFiles', () => {
  it('walks the directory and returns sorted spec files', async () => {
    const fs = new InMemoryFs();
    fs.set('/specs/login.spec.ts', 'x');
    fs.set('/specs/checkout/cart.spec.ts', 'x');
    fs.set('/specs/checkout/notes.md', 'ignore');
    const out = await listSpecFiles('/specs', fs);
    expect(out).toEqual(['/specs/checkout/cart.spec.ts', '/specs/login.spec.ts']);
  });
  it('returns empty when the dir is missing', async () => {
    const fs = new InMemoryFs();
    const out = await listSpecFiles('/missing', fs);
    expect(out).toEqual([]);
  });
});

describe('createDefaultSpecStrategy', () => {
  it('env-passthrough mode lists spec files without rewrite', async () => {
    const fs = new InMemoryFs();
    fs.set('/tickets/T-1/tests/e2e/login.spec.ts', 'page.goto("http://localhost:3000/x")');
    const strategy = createDefaultSpecStrategy({
      resolveSpecDir: (t) => `/tickets/${t.ticketId}/tests/e2e`,
      fsImpl: fs,
    });
    const resolution = await strategy.resolveSpecs(target({ ticketId: 'T-1' }));
    expect(resolution.rewrittenSpecCount).toBe(0);
    expect(resolution.specFiles).toEqual(['/tickets/T-1/tests/e2e/login.spec.ts']);
    expect(resolution.baseUrl).toBe('https://app.example.com');
  });

  it('rewrite mode copies + rewrites localhost URLs', async () => {
    const fs = new InMemoryFs();
    fs.set('/tickets/T-2/tests/e2e/login.spec.ts', 'page.goto("http://localhost:3000/x")');
    const strategy = createDefaultSpecStrategy({
      resolveSpecDir: (t) => `/tickets/${t.ticketId}/tests/e2e`,
      rewriteInPlace: true,
      tmpRoot: '/scratch',
      fsImpl: fs,
    });
    const resolution = await strategy.resolveSpecs(target({ ticketId: 'T-2' }));
    expect(resolution.specFiles.length).toBe(1);
    const out = fs.get(resolution.specFiles[0]!);
    expect(out).toBe('page.goto("https://app.example.com/x")');
    expect(resolution.rewrittenSpecCount).toBe(1);
  });

  it('rewrite mode reports zero rewritten when nothing changed', async () => {
    const fs = new InMemoryFs();
    fs.set('/tickets/T-3/tests/e2e/login.spec.ts', 'page.goto("https://app.example.com/x")');
    const strategy = createDefaultSpecStrategy({
      resolveSpecDir: () => '/tickets/T-3/tests/e2e',
      rewriteInPlace: true,
      tmpRoot: '/scratch',
      fsImpl: fs,
    });
    const resolution = await strategy.resolveSpecs(target({ ticketId: 'T-3' }));
    expect(resolution.rewrittenSpecCount).toBe(0);
  });
});
