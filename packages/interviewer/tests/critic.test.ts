import { describe, expect, it } from 'vitest';

import { Critic } from '../src/critic.js';
import { InterviewerError } from '../src/errors.js';
import { ScriptedLlmCaller } from '../src/llm.js';
import { emptyBusinessPlan } from '../src/business-plan.js';
import type { CriticPassResult } from '../src/types.js';

const samplePlan = () =>
  emptyBusinessPlan({
    interviewId: '00000000-0000-0000-0000-000000000010',
    operatorEmail: 'op@example.com',
  });

function meetingVerdict(): Omit<CriticPassResult, 'ranAtTurn' | 'passNumber'> {
  return {
    recommendation: 'meeting',
    top5DecisionFactors: [
      { factor: 'sharp wedge', quote: 'wedge', sentiment: 'positive' },
      { factor: 'real ICP', quote: 'icp', sentiment: 'positive' },
      { factor: 'evidence', quote: 'tam', sentiment: 'positive' },
      { factor: 'pricing', quote: '$29', sentiment: 'positive' },
      { factor: 'risks', quote: 'premortem', sentiment: 'positive' },
    ],
    meetingQuestions: ['How is GTM going?'],
    blockers: [],
  };
}

function passKindVerdict(): Omit<CriticPassResult, 'ranAtTurn' | 'passNumber'> {
  return {
    ...meetingVerdict(),
    recommendation: 'pass_kind',
    blockers: [{ issue: 'TAM not sourced', planSection: 'marketOpportunity', severity: 'blocker' }],
  };
}

describe('Critic.gate decision logic', () => {
  it('approves when recommendation=meeting and no blockers', () => {
    const v: CriticPassResult = { ...meetingVerdict(), ranAtTurn: 12, passNumber: 1 };
    const d = Critic.gate(v);
    expect(d.approved).toBe(true);
    expect(d.recommendation).toBe('meeting');
    expect(d.blockingIssues).toHaveLength(0);
  });

  it('rejects pass_kind regardless of blockers', () => {
    const v: CriticPassResult = { ...meetingVerdict(), recommendation: 'pass_kind', blockers: [], ranAtTurn: 12, passNumber: 1 };
    const d = Critic.gate(v);
    expect(d.approved).toBe(false);
  });

  it('rejects meeting with any blocker-severity item', () => {
    const v: CriticPassResult = {
      ...meetingVerdict(),
      blockers: [{ issue: 'x', planSection: 'unitEconomics', severity: 'blocker' }],
      ranAtTurn: 12, passNumber: 1,
    };
    const d = Critic.gate(v);
    expect(d.approved).toBe(false);
    expect(d.pickerHints).toContain('unitEconomics');
  });

  it('surfaces major blockers as picker hints', () => {
    const v: CriticPassResult = {
      ...passKindVerdict(),
      blockers: [
        { issue: 'a', planSection: 'unitEconomics', severity: 'major' },
        { issue: 'b', planSection: 'mvpScope', severity: 'minor' },
      ],
      ranAtTurn: 8, passNumber: 1,
    };
    const d = Critic.gate(v);
    expect(d.pickerHints).toContain('unitEconomics');
    expect(d.pickerHints).not.toContain('mvpScope');
  });

  it('de-dupes picker hints', () => {
    const v: CriticPassResult = {
      ...passKindVerdict(),
      blockers: [
        { issue: 'a', planSection: 'unitEconomics', severity: 'blocker' },
        { issue: 'b', planSection: 'unitEconomics', severity: 'major' },
      ],
      ranAtTurn: 8, passNumber: 1,
    };
    const d = Critic.gate(v);
    expect(d.pickerHints).toHaveLength(1);
  });
});

describe('Critic.run — LLM dispatch', () => {
  it('parses a clean meeting verdict', async () => {
    const llm = new ScriptedLlmCaller([{ match: 'PLAN:', response: meetingVerdict() }]);
    const critic = new Critic({ llm });
    const verdict = await critic.run({ plan: samplePlan(), atTurn: 12 });
    expect(verdict.recommendation).toBe('meeting');
    expect(verdict.passNumber).toBe(1);
    expect(verdict.ranAtTurn).toBe(12);
    expect(critic.passesRun).toBe(1);
  });

  it('throws when LLM returns malformed JSON', async () => {
    const llm = new ScriptedLlmCaller([{ match: 'PLAN:', response: 'this is not json at all' }]);
    const critic = new Critic({ llm });
    await expect(critic.run({ plan: samplePlan(), atTurn: 10 })).rejects.toThrowError(InterviewerError);
  });

  it('normalizes snake_case keys (top_5_decision_factors)', async () => {
    const snakeShape = {
      recommendation: 'meeting',
      top_5_decision_factors: meetingVerdict().top5DecisionFactors,
      meeting_questions: ['x?'],
      blockers: [],
    };
    const llm = new ScriptedLlmCaller([{ match: 'PLAN:', response: snakeShape }]);
    const critic = new Critic({ llm });
    const v = await critic.run({ plan: samplePlan(), atTurn: 5 });
    expect(v.top5DecisionFactors).toHaveLength(5);
  });

  it('enforces the max-passes cap', async () => {
    const llm = new ScriptedLlmCaller([{ match: 'PLAN:', response: meetingVerdict() }]);
    const critic = new Critic({ llm, maxPasses: 2 });
    await critic.run({ plan: samplePlan(), atTurn: 8 });
    await critic.run({ plan: samplePlan(), atTurn: 10 });
    expect(critic.atCap).toBe(true);
    await expect(critic.run({ plan: samplePlan(), atTurn: 12 })).rejects.toThrowError(InterviewerError);
  });

  it('counts pass numbers correctly across multiple runs', async () => {
    const llm = new ScriptedLlmCaller([{ match: 'PLAN:', response: meetingVerdict() }]);
    const critic = new Critic({ llm });
    const v1 = await critic.run({ plan: samplePlan(), atTurn: 8 });
    const v2 = await critic.run({ plan: samplePlan(), atTurn: 12 });
    expect(v1.passNumber).toBe(1);
    expect(v2.passNumber).toBe(2);
  });
});
