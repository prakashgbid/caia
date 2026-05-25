import { describe, expect, it } from 'vitest';

import { ScriptedLlmCaller } from '../src/llm.js';
import {
  execSummaryPrompt,
  fullProposalPrompt,
  onePagerPrompt,
} from '../src/proposal/prompts.js';
import { renderExecSummary, stripWrapping } from '../src/proposal/render-exec-summary.js';
import { renderFullProposal } from '../src/proposal/render-full.js';
import { renderOnePager } from '../src/proposal/render-one-pager.js';
import { sampleIa, samplePlan } from './fixtures/sample-plan.js';

describe('execSummaryPrompt', () => {
  it('includes the task header + word cap', () => {
    const p = execSummaryPrompt(samplePlan(), sampleIa());
    expect(p).toMatch(/EXECUTIVE SUMMARY/);
    expect(p).toMatch(/400 words/);
  });
});

describe('fullProposalPrompt', () => {
  it('embeds the exec summary into the prompt', () => {
    const p = fullProposalPrompt(samplePlan(), sampleIa(), 'EXEC SUMMARY VERBATIM');
    expect(p).toMatch(/EXEC SUMMARY VERBATIM/);
  });
});

describe('onePagerPrompt', () => {
  it('lists the five required blocks', () => {
    const p = onePagerPrompt(samplePlan(), sampleIa());
    expect(p).toMatch(/in-scope/);
    expect(p).toMatch(/out-of-scope/);
  });
});

describe('renderExecSummary', () => {
  it('returns the LLM text trimmed of code fences', async () => {
    const valid =
      '# Project\n' + Array(120).fill('word').join(' ');
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: '```markdown\n' + valid + '\n```' }]);
    const out = await renderExecSummary({ llmCaller: caller, plan: samplePlan(), ia: sampleIa() });
    expect(out.startsWith('# Project')).toBe(true);
    expect(out.includes('```')).toBe(false);
  });

  it('rejects LLM output that breaks word-count bounds', async () => {
    const tooShort = '# T\nshort';
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: tooShort }]);
    await expect(
      renderExecSummary({ llmCaller: caller, plan: samplePlan(), ia: sampleIa() }),
    ).rejects.toMatchObject({ code: 'word_count_violation' });
  });

  it('propagates LLM failures as llm_call_failed', async () => {
    const caller = new ScriptedLlmCaller([{ kind: 'fail', diagnostic: 'simulated' }]);
    await expect(
      renderExecSummary({ llmCaller: caller, plan: samplePlan(), ia: sampleIa() }),
    ).rejects.toMatchObject({ code: 'llm_call_failed' });
  });
});

describe('renderFullProposal', () => {
  it('returns body that meets the full-proposal bounds', async () => {
    const md =
      '# T\n## A\n## B\n## C\n## D\n' + Array(3000).fill('word').join(' ');
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: md }]);
    const out = await renderFullProposal({
      llmCaller: caller,
      plan: samplePlan(),
      ia: sampleIa(),
      execSummaryMd: '# Exec',
    });
    expect(out).toContain('## A');
  });
});

describe('renderOnePager', () => {
  it('returns body inside the 320-word cap', async () => {
    const md = '## A\n' + Array(80).fill('word').join(' ');
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: md }]);
    const out = await renderOnePager({ llmCaller: caller, plan: samplePlan(), ia: sampleIa() });
    expect(out).toContain('## A');
  });
});

describe('stripWrapping', () => {
  it('strips a markdown fence', () => {
    expect(stripWrapping('```md\nhello\n```')).toBe('hello');
  });
  it('passes through plain text', () => {
    expect(stripWrapping('plain')).toBe('plain');
  });
});
