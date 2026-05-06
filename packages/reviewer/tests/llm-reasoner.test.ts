import { describe, expect, it } from 'vitest';
import { buildPrompt, parseLlmOutput, createDefaultLlmReviewer } from '../src/llm-reasoner.js';
import type { LlmReviewInput } from '../src/types.js';

describe('buildPrompt', () => {
  it('includes dimensions, conventions, and hunks', () => {
    const input: LlmReviewInput = {
      hunks: [{
        file: 'a.ts', oldStart: 1, newStart: 1,
        header: '@@', body: '+x', status: 'added'
      }],
      conventionExcerpts: [{ source: 'AGENTS.md', heading: 'Code style', bodyExcerpt: 'no any' }],
      pr: { prNumber: 7, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    };
    const p = buildPrompt(input);
    expect(p).toContain('naming-convention');
    expect(p).toContain('Code style');
    expect(p).toContain('a.ts');
    expect(p).toContain('prNumber: 7');
    expect(p).toContain('CRITICAL: do NOT flag');
  });

  it('falls back to message when no conventions', () => {
    const input: LlmReviewInput = {
      hunks: [],
      conventionExcerpts: [],
      pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    };
    const p = buildPrompt(input);
    expect(p).toContain('(none —');
  });
});

describe('parseLlmOutput', () => {
  const wrap = (inner: string): string => JSON.stringify({ result: inner });

  it('returns ok=false for non-JSON', () => {
    const out = parseLlmOutput('not json');
    expect(out.ok).toBe(false);
  });

  it('returns ok=false when envelope missing result', () => {
    const out = parseLlmOutput(JSON.stringify({ wrong: 'shape' }));
    expect(out.ok).toBe(false);
  });

  it('returns ok=true with empty findings when none', () => {
    const out = parseLlmOutput(wrap('{"findings":[]}'));
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(0);
  });

  it('parses a valid finding', () => {
    const inner = '{"findings":[{"dimension":"naming-convention","severity":"nit","file":"a.ts","line":3,"suggestionTitle":"x","description":"y","excerpt":"z"}]}';
    const out = parseLlmOutput(wrap(inner));
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.dimension).toBe('naming-convention');
  });

  it('drops findings with Critic-denylist dimension', () => {
    const inner = '{"findings":[{"dimension":"security-regression","severity":"consider","file":"a.ts","line":1,"suggestionTitle":"x","description":"y"}]}';
    const out = parseLlmOutput(wrap(inner));
    expect(out.findings).toHaveLength(0);
  });

  it('extracts inner JSON from prose-wrapped result', () => {
    const inner = 'Here is the JSON: {"findings":[]} thanks';
    const out = parseLlmOutput(wrap(inner));
    expect(out.ok).toBe(true);
  });

  it('caps invented severities at the dimension default', () => {
    const inner = '{"findings":[{"dimension":"naming-convention","severity":"consider","file":"a.ts","line":1,"suggestionTitle":"x","description":"y"}]}';
    const out = parseLlmOutput(wrap(inner));
    // naming-convention default is 'nit'; LLM tried to bump to 'consider' — clamped.
    expect(out.findings[0]?.severity).toBe('nit');
  });
});

describe('createDefaultLlmReviewer (with spawnFn seam)', () => {
  it('returns ok=false on non-zero exit', async () => {
    const reviewer = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: (() => ({ status: 1, stdout: '', stderr: 'oops', error: null, signal: null, output: [] })) as never
    });
    const out = await reviewer.review({
      hunks: [], conventionExcerpts: [],
      pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    });
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('exited 1');
  });

  it('deletes ANTHROPIC_API_KEY from spawned env', async () => {
    let capturedEnv: NodeJS.ProcessEnv | null = null;
    const reviewer = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: ((_cmd, _args, opts) => {
        capturedEnv = opts.env;
        return { status: 0, stdout: JSON.stringify({ result: '{"findings":[]}' }), stderr: '', error: null, signal: null, output: [] };
      }) as never
    });
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    try {
      await reviewer.review({
        hunks: [], conventionExcerpts: [],
        pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
      });
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
    expect(capturedEnv).not.toBeNull();
    expect((capturedEnv as NodeJS.ProcessEnv | null)?.['ANTHROPIC_API_KEY']).toBeUndefined();
  });
});
