import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findLiteralCandidates,
  parseIdentifierOverrides,
} from '../../src/crossref/literal-pattern.js';

// ---------------------------------------------------------------------------
// Test helpers — build a throwaway git repo on disk per test.
// ---------------------------------------------------------------------------

interface FixtureFile {
  path: string;
  content: string;
}

function mkRepo(files: ReadonlyArray<FixtureFile>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  for (const f of files) {
    const abs = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
  }
  // `git grep` searches the index by default — staging is enough.
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

function rmRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findLiteralCandidates', () => {
  const created: string[] = [];
  afterEach(() => {
    while (created.length) {
      const d = created.pop();
      if (d) rmRepo(d);
    }
  });
  function repo(files: ReadonlyArray<FixtureFile>): string {
    const d = mkRepo(files);
    created.push(d);
    return d;
  }

  it('finds guardrails-validator/scanPii adoption sites and drops own-dir hits', () => {
    const root = repo([
      {
        path: 'packages/guardrails-validator/src/index.ts',
        content: "export function scanPii(input: string) { return input; }\n",
      },
      {
        path: 'apps/worker-coding/src/safety/pii.ts',
        content: "import { scanPii } from '@chiefaia/guardrails-validator';\nexport function check(s: string) { return scanPii(s); }\n",
      },
      {
        path: 'apps/orchestrator/src/router/sanitize.ts',
        content: "// TODO: use scanPii here\nfunction sanitize(s: string) { return s; }\n",
      },
      // Excluded directories must be ignored.
      { path: 'node_modules/leftover/scanPii-noise.js', content: "scanPii('x')\n" },
      { path: 'dist/build/scanPii-bundle.js', content: "scanPii('x')\n" },
      { path: 'pnpm-lock.yaml', content: "scanPii: '0.0.0'\n" },
    ]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: 'guardrails-validator', identifier: 'scanPii' },
      { repoRoot: root },
    );
    const files = [...new Set(out.map((c) => c.file))].sort();
    expect(files).toEqual([
      'apps/orchestrator/src/router/sanitize.ts',
      'apps/worker-coding/src/safety/pii.ts',
    ]);
    expect(out.every((c) => c.confidence === 'literal')).toBe(true);
    expect(out.every((c) => c.reason === 'identifier match outside its own package')).toBe(true);
    const first = out.find((c) => c.file === 'apps/worker-coding/src/safety/pii.ts');
    expect(first).toBeDefined();
    expect(first?.line).toBeGreaterThan(0);
    expect(first?.match).toContain('scanPii');
  });

  it('finds tracing/Tracer adoption sites', () => {
    const root = repo([
      {
        path: 'packages/tracing/src/index.ts',
        content: "export class Tracer { startSpan() {} }\n",
      },
      {
        path: 'apps/orchestrator/src/dispatch.ts',
        content: "import { Tracer } from '@chiefaia/tracing';\nconst t = new Tracer();\n",
      },
      {
        path: 'services/router/src/server.ts',
        content: "// Tracer goes here later\n",
      },
      // Should be skipped — own package.
      {
        path: 'packages/tracing/src/internal.ts',
        content: "import { Tracer } from './public.js';\n",
      },
    ]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: '@chiefaia/tracing', identifier: 'Tracer' },
      { repoRoot: root },
    );
    const files = [...new Set(out.map((c) => c.file))].sort();
    expect(files).toEqual([
      'apps/orchestrator/src/dispatch.ts',
      'services/router/src/server.ts',
    ]);
  });

  it('finds system-prompt-block/generateCaiaPrimer adoption sites', () => {
    const root = repo([
      {
        path: 'packages/system-prompt-block/src/index.ts',
        content: "export function generateCaiaPrimer(): string { return ''; }\n",
      },
      {
        path: 'apps/orchestrator/src/api/routes/agents.ts',
        content: "// TODO: replace inline systemPrompt with generateCaiaPrimer()\nconst systemPrompt = 'You are...';\n",
      },
      {
        path: 'apps/worker-coding/src/implementation-engine.ts',
        content: "// generateCaiaPrimer not yet wired here\nconst systemPrompt = 'You are a coder...';\n",
      },
    ]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: 'system-prompt-block', identifier: 'generateCaiaPrimer' },
      { repoRoot: root },
    );
    const files = [...new Set(out.map((c) => c.file))].sort();
    expect(files).toEqual([
      'apps/orchestrator/src/api/routes/agents.ts',
      'apps/worker-coding/src/implementation-engine.ts',
    ]);
  });

  it('drops identifiers shorter than min-length (default 6) unless overridden', () => {
    const root = repo([
      { path: 'packages/foo/src/index.ts', content: "export const bar = 1;\n" },
      { path: 'apps/baz/src/x.ts', content: "import { bar } from '@chiefaia/foo';\n" },
    ]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'bar' },
      { repoRoot: root },
    );
    expect(out).toEqual([]);
  });

  it('honours .adoption/identifier-overrides.yaml to bypass min-length', () => {
    const root = repo([
      { path: 'packages/foo/src/index.ts', content: "export const bar = 1;\n" },
      { path: 'apps/baz/src/x.ts', content: "import { bar } from '@chiefaia/foo';\n" },
      {
        path: '.adoption/identifier-overrides.yaml',
        content: "identifiers:\n  - bar\n",
      },
    ]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'bar' },
      { repoRoot: root },
    );
    expect(out.map((c) => c.file)).toEqual(['apps/baz/src/x.ts']);
  });

  it('drops stopwords even when overridden', () => {
    const root = repo([
      { path: 'packages/foo/src/index.ts', content: "export function options() {}\n" },
      { path: 'apps/baz/src/x.ts', content: "import { options } from '@chiefaia/foo';\n" },
      {
        path: '.adoption/identifier-overrides.yaml',
        content: "identifiers: [options]\n",
      },
    ]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'options' },
      { repoRoot: root },
    );
    expect(out).toEqual([]);
  });

  it('returns [] for empty / whitespace-only identifiers', () => {
    const root = repo([{ path: 'a.ts', content: "noop\n" }]);
    expect(findLiteralCandidates({ kind: 'new_export', package: 'x', identifier: '' }, { repoRoot: root })).toEqual([]);
    expect(findLiteralCandidates({ kind: 'new_export', package: 'x', identifier: '   ' }, { repoRoot: root })).toEqual([]);
  });

  it('returns [] when no matches at all', () => {
    const root = repo([{ path: 'packages/foo/src/index.ts', content: "export const someThing = 1;\n" }]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'nothereAnywhere' },
      { repoRoot: root },
    );
    expect(out).toEqual([]);
  });

  it('drops hits inside .claude/worktrees/', () => {
    const root = repo([
      { path: 'packages/foo/src/index.ts', content: "export function doTheThing() {}\n" },
      { path: '.claude/worktrees/sibling/apps/x.ts', content: "doTheThing()\n" },
      { path: 'apps/keeper/x.ts', content: "doTheThing()\n" },
    ]);
    const out = findLiteralCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'doTheThing' },
      { repoRoot: root },
    );
    expect(out.map((c) => c.file)).toEqual(['apps/keeper/x.ts']);
  });
});

describe('parseIdentifierOverrides', () => {
  it('parses inline flow form', () => {
    expect([...parseIdentifierOverrides("identifiers: ['a', \"b\", c]")]).toEqual(['a', 'b', 'c']);
  });
  it('parses block form', () => {
    const yaml = "identifiers:\n  - a\n  - 'b'\n  - \"c\"\n";
    expect([...parseIdentifierOverrides(yaml)]).toEqual(['a', 'b', 'c']);
  });
  it('returns empty set for missing key', () => {
    expect([...parseIdentifierOverrides('something_else: 1\n')]).toEqual([]);
  });
  it('strips comments without breaking quoted hashes', () => {
    const yaml = "identifiers:\n  - 'a#1'  # comment\n  - b   # another\n";
    expect([...parseIdentifierOverrides(yaml)]).toEqual(['a#1', 'b']);
  });
  it('stops at dedent in block form', () => {
    const yaml = "identifiers:\n  - a\n  - b\nother: x\n  - notInList\n";
    expect([...parseIdentifierOverrides(yaml)]).toEqual(['a', 'b']);
  });
});
