import { describe, expect, it } from 'vitest';

import { PlanDefenderSpawner, StubResponder, makeStubContextDump } from '@caia/plan-defender';

import {
  EaPlanReviewer,
  HeuristicVerdictRefiner,
  StubRoundOneAdapter,
  StubVerdictRefiner
} from '../src/index.js';
import type { RoundOneOutput, VerdictRefinerOutput } from '../src/index.js';

const baseSubmission = {
  planMarkdown: '# Plan\n\nBody',
  planType: 'research' as const,
  callerAgentId: 'test',
  submittedBy: 'test'
};

const baseContext = {
  adrs: [],
  principles: [],
  lessons: [],
  risks: [],
  feedback: []
};

const baseRoundOne: RoundOneOutput = {
  status: 'approved',
  reasoning: 'Looks fine.',
  cited_adrs: [],
  cited_principles: [],
  cited_lessons: [],
  requested_modifications: [],
  new_adrs_to_file: [],
  affected_existing_adrs: []
};

describe('EaPlanReviewer', () => {
  it('emits approved verdict with 0 rounds when round-1 has no question', async () => {
    const reviewer = new EaPlanReviewer({
      roundOne: new StubRoundOneAdapter(baseRoundOne)
    });
    const spawner = new PlanDefenderSpawner({ dialogueDir: '/tmp/d' });
    const verdict = await reviewer.review({
      submission: baseSubmission,
      contextDump: makeStubContextDump(),
      context: baseContext,
      submissionId: 's-1',
      iteration: 1,
      spawner
    });
    expect(verdict.status).toBe('approved');
    expect(verdict.defenderRoundsUsed).toBe(0);
    expect(verdict.dialogue.length).toBe(0);
  });

  it('iterates with the Defender when round-1 asks a question', async () => {
    const roundOne = new StubRoundOneAdapter({
      ...baseRoundOne,
      status: 'needs-clarification',
      reasoning: 'Need to clarify decision in §2',
      requested_modifications: ['clarify foo'],
      next_question: 'Why did you pick Stub decision option-a over option-b?',
      next_question_scope: 'section-2'
    });
    const refiner = new StubVerdictRefiner([
      // After round 1 — terminal verdict.
      { verdict: { ...baseRoundOne, status: 'approved' } } as VerdictRefinerOutput
    ]);
    const responder = new StubResponder([
      {
        round: 1,
        answer: 'X was chosen because Y has poor latency',
        cited_sources: ['decision_point:x-vs-y'],
        confidence: 'high',
        recommended_action: 'plan-stands',
        ts: '2026-05-24T00:00:00.000Z'
      }
    ]);
    const spawner = new PlanDefenderSpawner({ dialogueDir: '/tmp/d', responder });
    const reviewer = new EaPlanReviewer({ roundOne, refiner });
    const verdict = await reviewer.review({
      submission: baseSubmission,
      contextDump: makeStubContextDump(),
      context: baseContext,
      submissionId: 's-2',
      iteration: 1,
      spawner
    });
    expect(verdict.status).toBe('approved');
    expect(verdict.defenderRoundsUsed).toBe(1);
    expect(verdict.dialogue.length).toBe(1);
  });

  it('terminates on Defender escalation', async () => {
    const roundOne = new StubRoundOneAdapter({
      ...baseRoundOne,
      status: 'needs-clarification',
      next_question: 'should we pivot to a marketplace model?'
    });
    const responder = new StubResponder([]); // Stub will use synthesizeAnswerFromDump
    const spawner = new PlanDefenderSpawner({ dialogueDir: '/tmp/d', responder });
    const reviewer = new EaPlanReviewer({ roundOne });
    const verdict = await reviewer.review({
      submission: baseSubmission,
      contextDump: makeStubContextDump(),
      context: baseContext,
      submissionId: 's-3',
      iteration: 1,
      spawner
    });
    expect(verdict.defenderEscalation?.kind).toBe('strategic-class-question');
  });
});

describe('HeuristicVerdictRefiner', () => {
  it('promotes needs-clarification to approved on high-confidence plan-stands', async () => {
    const refiner = new HeuristicVerdictRefiner();
    const out = await refiner.refine({
      prior: { ...baseRoundOne, status: 'needs-clarification' },
      question: { round: 1, question: 'why X?', ts: 't' },
      answer: {
        round: 1,
        answer: 'because Y',
        cited_sources: [],
        confidence: 'high',
        recommended_action: 'plan-stands',
        ts: 't'
      },
      round: 1,
      cap: 5
    });
    expect(out.verdict.status).toBe('approved');
    expect(out.next_question).toBeUndefined();
  });

  it('adds requested_modifications on plan-needs-revision', async () => {
    const refiner = new HeuristicVerdictRefiner();
    const out = await refiner.refine({
      prior: { ...baseRoundOne },
      question: { round: 1, question: 'why X?', ts: 't' },
      answer: {
        round: 1,
        answer: 'Producer left this open; needs revision.',
        cited_sources: [],
        confidence: 'medium',
        recommended_action: 'plan-needs-revision',
        ts: 't'
      },
      round: 1,
      cap: 5
    });
    expect(out.verdict.status).toBe('approved-with-modifications');
    expect(out.verdict.requested_modifications.length).toBe(1);
  });

  it('escalates on Defender escalate-to-operator', async () => {
    const refiner = new HeuristicVerdictRefiner();
    const out = await refiner.refine({
      prior: { ...baseRoundOne },
      question: { round: 1, question: 'q', ts: 't' },
      answer: {
        round: 1,
        answer: 'escalate',
        cited_sources: [],
        confidence: 'low',
        recommended_action: 'escalate-to-operator',
        ts: 't'
      },
      round: 1,
      cap: 5
    });
    expect(out.verdict.escalation_to_operator).toBeDefined();
  });
});
