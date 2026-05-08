import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  createDefaultLlmReviewer,
  noopLlmReviewer,
  parseLlmOutput
} from '../src/llm-reasoner.js';
import type { DiffHunk, LlmReviewInput } from '../src/types.js';

const sampleHunk: DiffHunk = {
  file: 'src/foo.ts',
  oldStart: 1,
  newStart: 1,
  header: '@@ -1,2 +1,2 @@',
  body: '-let x = null;\n+let x: string | null = null;',
  status: 'modified'
};

const sampleInput: LlmReviewInput = {
  hunks: [sampleHunk],
  conventionExcerpts: [],
  pr: {
    prNumber: 42,
    branch: 'feat/x',
    baseBranch: 'develop',
    title: 'Fix nullable',
    commitSubjects: []
  }
};

describe('buildPrompt', () => {
  it('embeds the system instructions', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('CORRECTNESS, BUGS');
    expect(p).toContain('STAY IN YOUR LANE');
  });

  it('includes the dimensions block', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('correctness:');
    expect(p).toContain('bug-risk:');
    expect(p).toContain('test-coverage:');
  });

  it('includes the diff hunks', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('src/foo.ts');
    expect(p).toContain('let x: string | null');
  });

  it('falls back to default when no conventions', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('(none — fall back to general TS / Node best practices)');
  });

  it('embeds convention excerpts when present', () => {
    const p = buildPrompt({
      ...sampleInput,
      conventionExcerpts: [{ source: 'A.md', heading: 'Code style', bodyExcerpt: 'use 2 spaces' }]
    });
    expect(p).toContain('Code style');
    expect(p).toContain('use 2 spaces');
  });
});

describe('parseLlmOutput', () => {
  it('parses well-formed output', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          {
            dimension: 'correctness',
            severity: 'high',
            file: 'src/foo.ts',
            line: 10,
            issueTitle: 'null-deref',
            description: 'risk of null deref',
            excerpt: 'foo.bar()'
          }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].dimension).toBe('correctness');
    expect(out.findings[0].severity).toBe('high');
  });

  it('reports a parse error on bad outer JSON', () => {
    const out = parseLlmOutput('not json');
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('outer JSON parse');
  });

  it('reports envelope missing result', () => {
    const out = parseLlmOutput(JSON.stringify({ no_result: true }));
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('result');
  });

  it('reports inner parse error', () => {
    const stdout = JSON.stringify({ result: '{not valid}' });
    const out = parseLlmOutput(stdout);
    expect(out.ok).toBe(false);
  });

  it('drops findings on Critic denylist', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'security-regression', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' },
          { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].dimension).toBe('correctness');
  });

  it('drops findings on advisory Reviewer denylist', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'idiom-adherence', severity: 'medium', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(0);
  });

  it('drops findings with unknown dimension', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'totally-made-up', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(0);
  });

  it('drops findings without file or description', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'correctness', severity: 'high', file: '', line: 1, issueTitle: 't', description: 'x' },
          { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: '' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(0);
  });

  it('uses default severity when invalid', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'correctness', severity: 'banana', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe('high'); // default for correctness
  });

  it('caps style severity at default ceiling', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'style', severity: 'critical', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings[0].severity).toBe('low'); // capped at default for style
  });

  it('allows correctness to promote to critical', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'correctness', severity: 'critical', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings[0].severity).toBe('critical');
  });

  it('returns empty findings when array missing', () => {
    const stdout = JSON.stringify({ result: JSON.stringify({}) });
    const out = parseLlmOutput(stdout);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(0);
  });

  it('extracts JSON from prose-wrapped result', () => {
    const stdout = JSON.stringify({
      result: 'Here is the analysis: {"findings":[{"dimension":"correctness","severity":"medium","file":"a.ts","line":1,"issueTitle":"t","description":"x"}]} done.'
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(1);
  });
});

describe('createDefaultLlmReviewer (subscription-only)', () => {
  it('strips ANTHROPIC_API_KEY from spawn env', async () => {
    let capturedEnv: NodeJS.ProcessEnv = {};
    const fakeSpawn = (_cmd: string, _args: readonly string[], opts: { input: string; encoding: 'utf-8'; timeout: number; env: NodeJS.ProcessEnv }) => {
      capturedEnv = opts.env;
      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify({ result: JSON.stringify({ findings: [] }) }),
        stderr: '',
        status: 0,
        signal: null
      } as ReturnType<typeof import('node:child_process').spawnSync>;
    };
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-fake';
    try {
      const llm = createDefaultLlmReviewer({
        binaryPath: 'claude',
        modelTag: 'claude-haiku-4-5-20251001',
        timeoutMs: 1000,
        spawnFn: fakeSpawn
      });
      await llm.review(sampleInput);
      expect('ANTHROPIC_API_KEY' in capturedEnv).toBe(false);
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('returns ok:false on spawn error', async () => {
    const fakeSpawn = () => ({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: new Error('ENOENT')
    } as unknown as ReturnType<typeof import('node:child_process').spawnSync>);
    const llm = createDefaultLlmReviewer({
      binaryPath: 'nonexistent',
      modelTag: 'm',
      timeoutMs: 100,
      spawnFn: fakeSpawn
    });
    const out = await llm.review(sampleInput);
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('ENOENT');
  });

  it('returns ok:false on non-zero exit', async () => {
    const fakeSpawn = () => ({
      pid: 1,
      output: [],
      stdout: '',
      stderr: 'rate-limited',
      status: 1,
      signal: null
    } as ReturnType<typeof import('node:child_process').spawnSync>);
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude',
      modelTag: 'm',
      timeoutMs: 100,
      spawnFn: fakeSpawn
    });
    const out = await llm.review(sampleInput);
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('exited');
  });

  it('parses successful spawn output', async () => {
    const fakeSpawn = () => ({
      pid: 1,
      output: [],
      stdout: JSON.stringify({
        result: JSON.stringify({
          findings: [
            { dimension: 'bug-risk', severity: 'high', file: 'a.ts', line: 1, issueTitle: 'race', description: 'shared state' }
          ]
        })
      }),
      stderr: '',
      status: 0,
      signal: null
    } as ReturnType<typeof import('node:child_process').spawnSync>);
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude',
      modelTag: 'm',
      timeoutMs: 100,
      spawnFn: fakeSpawn
    });
    const out = await llm.review(sampleInput);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(1);
  });
});

describe('noopLlmReviewer', () => {
  it('returns empty findings', async () => {
    const out = await noopLlmReviewer.review(sampleInput);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(0);
  });
});
