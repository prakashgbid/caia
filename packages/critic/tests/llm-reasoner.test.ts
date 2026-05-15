import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseLlmOutput,
  buildPromptDebug,
  noopLlmReasoner,
  createDefaultLlmReasoner
} from '../src/llm-reasoner.js';
import { CANONICAL_TAXONOMY } from '../src/taxonomy.js';
import type { DiffHunk } from '../src/types.js';

describe('parseLlmOutput', () => {
  it('parses a well-formed envelope', () => {
    const inner = JSON.stringify({
      findings: [
        {
          category: 'premature-completion',
          severity: 'high',
          file: 'foo.ts',
          line: 12,
          attackVector: 'fake-shipped-claim',
          description: 'Says "shipped" but no tests.',
          reproductionSteps: ['look at line 12'],
          suggestedMitigation: 'add tests',
          excerpt: 'Status: shipped'
        }
      ]
    });
    const outer = JSON.stringify({ result: inner });
    const r = parseLlmOutput(outer);
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.category).toBe('premature-completion');
    expect(r.findings[0]?.severity).toBe('high');
  });

  it('handles prose-wrapped inner JSON', () => {
    const inner = `Sure, here is the JSON:\n{"findings":[{"category":"hallucination","severity":"high","file":"f.ts","line":1,"attackVector":"x","description":"y","reproductionSteps":[]}]}\nThanks!`;
    const r = parseLlmOutput(JSON.stringify({ result: inner }));
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(1);
  });

  it('drops findings with unknown category', () => {
    const inner = JSON.stringify({
      findings: [
        { category: 'invented-category', severity: 'high', file: 'f.ts', line: 1, attackVector: 'x', description: 'y', reproductionSteps: [] }
      ]
    });
    const r = parseLlmOutput(JSON.stringify({ result: inner }));
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('floors severity to category-default when LLM downplays', () => {
    const inner = JSON.stringify({
      findings: [
        { category: 'security-regression', severity: 'low', file: 'f.ts', line: 1, attackVector: 'x', description: 'y', reproductionSteps: [] }
      ]
    });
    const r = parseLlmOutput(JSON.stringify({ result: inner }));
    expect(r.findings[0]?.severity).toBe('critical'); // bumped from low → category default
  });

  it('returns ok:false on garbage outer', () => {
    const r = parseLlmOutput('not json');
    expect(r.ok).toBe(false);
  });

  it('returns ok:false on missing result string', () => {
    const r = parseLlmOutput(JSON.stringify({ no_result: true }));
    expect(r.ok).toBe(false);
  });

  it('returns ok:true + [] when findings missing', () => {
    const r = parseLlmOutput(JSON.stringify({ result: '{"foo":"bar"}' }));
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(0);
  });
});

describe('buildPromptDebug', () => {
  it('mentions every taxonomy entry', () => {
    const hunk: DiffHunk = {
      file: 'foo.ts',
      oldStart: 1,
      newStart: 1,
      header: '@@ -1 +1 @@',
      body: '+x',
      status: 'modified'
    };
    const prompt = buildPromptDebug(CANONICAL_TAXONOMY, [hunk]);
    for (const e of CANONICAL_TAXONOMY) {
      expect(prompt).toContain(e.id);
    }
  });
});

describe('noopLlmReasoner', () => {
  it('returns ok:true with empty findings', async () => {
    const r = await noopLlmReasoner.reason({
      hunks: [],
      taxonomy: CANONICAL_TAXONOMY,
      pr: { prNumber: 0, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    });
    expect(r.ok).toBe(true);
  });
});

describe('createDefaultLlmReasoner', () => {
  it('uses injected spawnFn and nukes ANTHROPIC_API_KEY from env', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude',
      modelTag: 'm',
      timeoutMs: 1000,
      spawnFn: (_cmd, _args, opts) => {
        capturedEnv = opts.env;
        return {
          status: 0,
          stdout: JSON.stringify({ result: '{"findings":[]}' }),
          stderr: '',
          pid: 1,
          output: ['', '', ''],
          signal: null
        };
      }
    });
    process.env['ANTHROPIC_API_KEY'] = 'should-not-leak';
    try {
      await reasoner.reason({
        hunks: [],
        taxonomy: CANONICAL_TAXONOMY,
        pr: { prNumber: 0, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
      });
      expect(capturedEnv?.['ANTHROPIC_API_KEY']).toBeUndefined();
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('returns ok:false on non-zero exit', async () => {
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude',
      modelTag: 'm',
      timeoutMs: 1000,
      spawnFn: () => ({
        status: 1,
        stdout: '',
        stderr: 'rate limited',
        pid: 1,
        output: ['', '', ''],
        signal: null
      })
    });
    const r = await reasoner.reason({
      hunks: [],
      taxonomy: CANONICAL_TAXONOMY,
      pr: { prNumber: 0, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    });
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toContain('exited 1');
  });

  it('returns ok:false on spawn error', async () => {
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude',
      modelTag: 'm',
      timeoutMs: 1000,
      spawnFn: () => ({
        status: null,
        stdout: '',
        stderr: '',
        pid: 0,
        output: ['', '', ''],
        signal: null,
        error: new Error('ENOENT')
      })
    });
    const r = await reasoner.reason({
      hunks: [],
      taxonomy: CANONICAL_TAXONOMY,
      pr: { prNumber: 0, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    });
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toContain('spawn error');
  });
});

describe('A.9.13 — small-diff local-router shortcut (Critic)', () => {
  const SMALL_HUNK: DiffHunk = {
    file: 'src/foo.ts',
    status: 'modified',
    header: '@@ -1,5 +1,6 @@',
    body: ['+ const a = 1;', '+ const b = 2;', '- const c = 3;'].join('\n'),
  };
  const LARGE_HUNK: DiffHunk = {
    file: 'src/big.ts',
    status: 'modified',
    header: '@@ -1,500 +1,500 @@',
    body: Array.from({ length: 250 }, (_, i) => `+ line ${i}`).join('\n'),
  };
  const PR_META = { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] };

  beforeEach(() => {
    delete process.env['CAIA_REVIEW_LOCAL_FIRST'];
    delete process.env['CAIA_REVIEW_LOCAL_DIFF_LINES_MAX'];
    delete process.env['CAIA_REVIEW_LOCAL_MODEL'];
    delete process.env['CAIA_REVIEW_LOCAL_TIMEOUT_MS'];
    delete process.env['ROUTER_BASE_URL'];
    vi.unstubAllGlobals();
  });

  it('does NOT call the local router when the env flag is off (default)', async () => {
    let spawned = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: () => { spawned = true; return {
        status: 0, stdout: JSON.stringify({ result: '{"findings":[]}' }), stderr: '',
        pid: 1, output: ['', '', ''], signal: null,
      }; }
    });
    await reasoner.reason({ hunks: [SMALL_HUNK], taxonomy: CANONICAL_TAXONOMY, pr: PR_META });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawned).toBe(true);
  });

  it('routes small diff to the local router when CAIA_REVIEW_LOCAL_FIRST=1', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    let spawned = false;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ findings: [] }) } }],
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: () => { spawned = true; return {
        status: 0, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null,
      }; }
    });
    const r = await reasoner.reason({ hunks: [SMALL_HUNK], taxonomy: CANONICAL_TAXONOMY, pr: PR_META });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(spawned).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('falls through to claude binary when diff exceeds line threshold', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: () => { spawned = true; return {
        status: 0, stdout: JSON.stringify({ result: '{"findings":[]}' }), stderr: '',
        pid: 1, output: ['', '', ''], signal: null,
      }; }
    });
    await reasoner.reason({ hunks: [LARGE_HUNK], taxonomy: CANONICAL_TAXONOMY, pr: PR_META });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawned).toBe(true);
  });

  it('falls through to claude binary when router returns non-2xx', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: () => { spawned = true; return {
        status: 0, stdout: JSON.stringify({ result: '{"findings":[]}' }), stderr: '',
        pid: 1, output: ['', '', ''], signal: null,
      }; }
    });
    await reasoner.reason({ hunks: [SMALL_HUNK], taxonomy: CANONICAL_TAXONOMY, pr: PR_META });
    expect(fetchSpy).toHaveBeenCalled();
    expect(spawned).toBe(true);
  });

  it('falls through to claude when router throws (network error)', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: () => { spawned = true; return {
        status: 0, stdout: JSON.stringify({ result: '{"findings":[]}' }), stderr: '',
        pid: 1, output: ['', '', ''], signal: null,
      }; }
    });
    await reasoner.reason({ hunks: [SMALL_HUNK], taxonomy: CANONICAL_TAXONOMY, pr: PR_META });
    expect(spawned).toBe(true);
  });

  it('honors CAIA_REVIEW_LOCAL_DIFF_LINES_MAX override', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    process.env['CAIA_REVIEW_LOCAL_DIFF_LINES_MAX'] = '2';  // below SMALL_HUNK's 3 lines
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const reasoner = createDefaultLlmReasoner({
      binaryPath: '/fake/claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: () => { spawned = true; return {
        status: 0, stdout: JSON.stringify({ result: '{"findings":[]}' }), stderr: '',
        pid: 1, output: ['', '', ''], signal: null,
      }; }
    });
    await reasoner.reason({ hunks: [SMALL_HUNK], taxonomy: CANONICAL_TAXONOMY, pr: PR_META });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawned).toBe(true);
  });
});
