import { beforeAll, describe, expect, it } from 'vitest';

import {
  Interviewer,
  loadPlaybook,
  MemoryInterviewerPersistence,
  type PlaybookIndex,
} from '../../src/index.js';
import {
  ALICE_CONSENTLANE,
  BOB_GREENZAP,
  PersonaLlm,
} from '../../src/test-support.js';

let playbook: PlaybookIndex;
beforeAll(async () => {
  playbook = await loadPlaybook();
});

// ─────────────────────────────────────────────────────────────────────────
// Alice / ConsentLane — convergent persona
// ─────────────────────────────────────────────────────────────────────────

describe('integration: scripted-founder Alice / ConsentLane', () => {
  it('converges to HANDOFF in 30-50 turns with rubric >= 82', async () => {
    const persistence = new MemoryInterviewerPersistence();
    const llm = new PersonaLlm({ persona: ALICE_CONSENTLANE, playbook, rubricMaturesAtTurn: 8 });
    let counter = 0;
    const interviewer = new Interviewer({
      playbook, llm, persistence,
      tenantSlug: 'alice', operatorEmail: 'alice@example.com',
      maxTurns: 60, llmCallBudget: 600,
      pillarFloor: 45,
      idFactory: () => {
        counter++;
        const c = counter.toString(16).padStart(12, '0');
        return `00000000-0000-0000-0000-${c}`;
      },
      clock: () => new Date('2026-05-23T00:00:00.000Z'),
    });

    const start = await interviewer.start({ grandIdeaPrompt: ALICE_CONSENTLANE.grandIdea });
    expect(start.state).toBe('AWAITING_USER');
    expect(start.turnNumber).toBe(1);
    expect(start.picked.strategy).toBe('cold_start');

    let lastResult = await interviewer.submitUserReply('Replying with the standard ConsentLane answers.');
    let turn = lastResult.turnNumber;
    while (lastResult.state === 'AWAITING_USER' && turn < 60) {
      lastResult = await interviewer.submitUserReply(`Reply for turn ${lastResult.turnNumber + 1}.`);
      turn = lastResult.turnNumber;
    }

    expect(['HANDOFF', 'FORCE_CLOSED']).toContain(lastResult.state);
    expect(lastResult.state).toBe('HANDOFF');
    expect(lastResult.handoff).not.toBeNull();
    expect(lastResult.criticVerdict?.recommendation).toBe('meeting');
    expect(lastResult.satisfactionScore).toBeGreaterThanOrEqual(82);
    expect(turn).toBeLessThanOrEqual(60);
    expect(persistence.getRevisions(start.interviewId).length).toBeGreaterThan(0);
    expect(persistence.getTurns(start.interviewId).length).toBeGreaterThanOrEqual(turn);
    const final = persistence.allInterviews()[0]!;
    expect(final.state).toBe('HANDOFF');
    expect(final.completedAt).not.toBeNull();
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────
// Bob / GreenZap — vague persona; does not false-converge
// ─────────────────────────────────────────────────────────────────────────

describe('integration: scripted-founder Bob / GreenZap (vague)', () => {
  it('plateaus below threshold and force-closes by maxTurns or budget', async () => {
    const persistence = new MemoryInterviewerPersistence();
    const llm = new PersonaLlm({ persona: BOB_GREENZAP, playbook, rubricMaturesAtTurn: 9999 });
    let counter = 0;
    const interviewer = new Interviewer({
      playbook, llm, persistence,
      tenantSlug: 'bob', operatorEmail: 'bob@example.com',
      maxTurns: 20, llmCallBudget: 200,
      idFactory: () => {
        counter++;
        const c = counter.toString(16).padStart(12, '0');
        return `00000000-0000-0000-0000-${c}`;
      },
    });

    await interviewer.start({ grandIdeaPrompt: BOB_GREENZAP.grandIdea });
    let lastResult = await interviewer.submitUserReply('Vague reply 1.');
    let turn = lastResult.turnNumber;
    while (lastResult.state === 'AWAITING_USER' && turn < 25) {
      lastResult = await interviewer.submitUserReply(`Vague reply turn ${lastResult.turnNumber + 1}.`);
      turn = lastResult.turnNumber;
    }

    expect(['HANDOFF', 'FORCE_CLOSED']).toContain(lastResult.state);
    expect(lastResult.state).toBe('FORCE_CLOSED');
    expect((lastResult.satisfactionScore ?? 0)).toBeLessThan(82);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────
// Resume + force-close API
// ─────────────────────────────────────────────────────────────────────────

describe('integration: pause / resume / force-close API', () => {
  it('pause + resume continues from a fresh PLANNING turn', async () => {
    const persistence = new MemoryInterviewerPersistence();
    const llm = new PersonaLlm({ persona: ALICE_CONSENTLANE, playbook });
    let counter = 0;
    const interviewer = new Interviewer({
      playbook, llm, persistence,
      tenantSlug: 'alice', operatorEmail: 'alice@example.com',
      maxTurns: 50, llmCallBudget: 500,
      idFactory: () => {
        counter++;
        const c = counter.toString(16).padStart(12, '0');
        return `00000000-0000-0000-0000-${c}`;
      },
    });

    await interviewer.start({ grandIdeaPrompt: ALICE_CONSENTLANE.grandIdea });
    expect(interviewer.getState()).toBe('AWAITING_USER');
    await interviewer.pause();
    expect(interviewer.getState()).toBe('PAUSED');
    const resumed = await interviewer.resume();
    expect(resumed.state).toBe('AWAITING_USER');
    expect(resumed.turnNumber).toBeGreaterThanOrEqual(2);
  });

  it('forceClose returns a finalized plan with openUnknowns', async () => {
    const persistence = new MemoryInterviewerPersistence();
    const llm = new PersonaLlm({ persona: ALICE_CONSENTLANE, playbook });
    let counter = 0;
    const interviewer = new Interviewer({
      playbook, llm, persistence,
      tenantSlug: 'alice', operatorEmail: 'alice@example.com',
      maxTurns: 50, llmCallBudget: 500,
      idFactory: () => {
        counter++;
        const c = counter.toString(16).padStart(12, '0');
        return `00000000-0000-0000-0000-${c}`;
      },
    });

    await interviewer.start({ grandIdeaPrompt: ALICE_CONSENTLANE.grandIdea });
    await interviewer.submitUserReply('First reply.');
    await interviewer.submitUserReply('Second reply.');

    const finalPlan = await interviewer.forceClose('alice@example.com', 'operator_force');
    expect(finalPlan).not.toBeNull();
    expect(interviewer.getState()).toBe('FORCE_CLOSED');
    expect(finalPlan!.openUnknowns.length).toBeGreaterThan(0);
    expect(finalPlan!.openUnknowns.every((u: any) => u.reason === 'operator_force_close')).toBe(true);
  });
});
