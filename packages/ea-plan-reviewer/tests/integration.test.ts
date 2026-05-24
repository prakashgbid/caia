/**
 * Integration tests against the real EA Repository on disk.
 *
 *   1. Smoke / happy path — submit a known-good plan, verify sign-off generated.
 *   2. Escalation path — submit ambiguous plan; verify escalation handling.
 *   3. Concurrency isolation — 3 plans in parallel; verify isolation.
 *
 * Real-LLM calls are stubbed via StubResponder + StubRoundOneAdapter so the
 * tests are deterministic. The plumbing exercised is real.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EaPlanReviewer,
  StubRoundOneAdapter,
  type RoundOneOutput
} from '../src/index.js';
import {
  PlanDefenderSpawner,
  StubResponder,
  makeStubContextDump,
  type DefenderAnswer
} from '@caia/plan-defender';

import {
  EaCoordinator,
  SignoffComposer,
  type CoordinatorPlanSubmission,
  type PlanReviewerAdapter,
  type SubAgentVerdict
} from '@caia/ea-architect';

const REAL_REPO = join(homedir(), 'Documents', 'projects', 'caia-ea');
const REAL_MEMORY = join(homedir(), 'Documents', 'projects', 'agent-memory');
const HAS_REAL_REPO = existsSync(REAL_REPO);

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'caia-ea-integration-'));
});
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function makeReviewerAdapter(
  answers: DefenderAnswer[],
  r1: RoundOneOutput
): PlanReviewerAdapter {
  return {
    async review(input): Promise<SubAgentVerdict> {
      const responder = new StubResponder(answers);
      const spawner = new PlanDefenderSpawner({
        dialogueDir: join(workDir, 'dialogues'),
        responder
      });
      const reviewer = new EaPlanReviewer({ roundOne: new StubRoundOneAdapter(r1) });
      const v = await reviewer.review({
        submission: {
          planMarkdown: input.submission.planMarkdown,
          planType: 'research',
          callerAgentId: input.submission.callerAgentId,
          submittedBy: input.submission.submittedBy
        },
        contextDump: input.contextDump as Parameters<typeof reviewer.review>[0]['contextDump'],
        context: { adrs: [], principles: [], lessons: [], risks: [], feedback: [] },
        submissionId: input.submissionId,
        iteration: input.iteration,
        spawner
      });
      const ret: SubAgentVerdict = {
        subAgent: 'ea-plan-reviewer',
        status: v.status,
        reasoning: v.reasoning,
        cited_adrs: v.cited_adrs,
        cited_principles: v.cited_principles,
        cited_lessons: v.cited_lessons,
        requested_modifications: v.requested_modifications,
        new_adrs_to_file: v.new_adrs_to_file,
        affected_existing_adrs: v.affected_existing_adrs,
        defenderRoundsUsed: v.defenderRoundsUsed,
        dialogueLogPath: v.dialogueLogPath,
        dialogue: v.dialogue.map((d) => ({
          q: { round: d.q.round, question: d.q.question, ts: d.q.ts, ...(d.q.scope !== undefined ? { scope: d.q.scope } : {}) },
          a: { round: d.a.round, answer: d.a.answer, cited_sources: d.a.cited_sources, confidence: d.a.confidence, recommended_action: d.a.recommended_action, ts: d.a.ts }
        })),
        ranAtIso: new Date().toISOString()
      };
      if (v.escalation_to_operator !== undefined) ret.escalation_to_operator = v.escalation_to_operator;
      return ret;
    }
  };
}

describe('Coordinator integration — smoke (happy path)', () => {
  it('routes research → ea-plan-reviewer; sign-off written', async () => {
    if (!HAS_REAL_REPO) return;
    const composer = new SignoffComposer({ repositoryPath: workDir });
    const c = new EaCoordinator({
      repositoryPath: REAL_REPO,
      inboxPath: join(workDir, 'INBOX.md'),
      agentMemoryPath: REAL_MEMORY,
      planReviewer: makeReviewerAdapter(
        [{ round: 1, answer: 'Stub decision option-a was chosen per ADR-001', cited_sources: ['decision_point:Stub decision'], confidence: 'high', recommended_action: 'plan-stands', ts: 't' }],
        { status: 'approved', reasoning: 'Aligns with P1 + ADR-001', cited_adrs: ['ADR-001'], cited_principles: ['P1'], cited_lessons: [], requested_modifications: [], new_adrs_to_file: [], affected_existing_adrs: [] }
      ),
      signoffComposer: composer,
      generateSubmissionId: (): string => `smoke-happy-${Date.now()}`
    });
    const outcome = await c.review({
      planMarkdown: '# Stub plan\n\nA tiny plan for the smoke test.',
      planType: 'research',
      callerAgentId: '@caia/researcher',
      submittedBy: 'integration-tests',
      contextDump: makeStubContextDump()
    } as CoordinatorPlanSubmission);
    expect(outcome.status).toBe('approved');
    expect(outcome.subAgentsInvoked).toEqual(['ea-plan-reviewer']);
    expect(existsSync(outcome.signoffPath)).toBe(true);
    const body = readFileSync(outcome.signoffPath, 'utf8');
    expect(body).toContain('EA Sign-Off');
    expect(body).toContain('TL;DR');
  }, 30_000);
});

describe('Coordinator integration — escalation path', () => {
  it('handles 3-low-confidence path; signoff still produced', async () => {
    const composer = new SignoffComposer({ repositoryPath: workDir });
    const c = new EaCoordinator({
      repositoryPath: HAS_REAL_REPO ? REAL_REPO : workDir,
      inboxPath: join(workDir, 'INBOX.md'),
      agentMemoryPath: HAS_REAL_REPO ? REAL_MEMORY : workDir,
      planReviewer: makeReviewerAdapter(
        [
          { round: 1, answer: 'low', cited_sources: [], confidence: 'low', recommended_action: 'plan-stands', ts: 't' },
          { round: 2, answer: 'low', cited_sources: [], confidence: 'low', recommended_action: 'plan-stands', ts: 't' },
          { round: 3, answer: 'low', cited_sources: [], confidence: 'low', recommended_action: 'plan-stands', ts: 't' }
        ],
        { status: 'needs-clarification', reasoning: 'Ambiguous', cited_adrs: [], cited_principles: [], cited_lessons: [], requested_modifications: ['clarify'], new_adrs_to_file: [], affected_existing_adrs: [], next_question: 'Why did you pick Stub decision option-a?' }
      ),
      signoffComposer: composer,
      generateSubmissionId: (): string => `smoke-escalation-${Date.now()}`
    });
    const outcome = await c.review({
      planMarkdown: '# Ambiguous plan', planType: 'research', callerAgentId: 't', submittedBy: 't', contextDump: makeStubContextDump()
    } as CoordinatorPlanSubmission);
    expect(['needs-clarification', 'rejected', 'approved-with-modifications']).toContain(outcome.status);
    expect(existsSync(outcome.signoffPath)).toBe(true);
  }, 30_000);
});

describe('Coordinator integration — concurrency isolation', () => {
  it('3 parallel submissions each get distinct outcomes + sign-offs', async () => {
    const composer = new SignoffComposer({ repositoryPath: workDir });
    const c = new EaCoordinator({
      repositoryPath: HAS_REAL_REPO ? REAL_REPO : workDir,
      inboxPath: join(workDir, 'INBOX.md'),
      agentMemoryPath: HAS_REAL_REPO ? REAL_MEMORY : workDir,
      planReviewer: makeReviewerAdapter(
        [{ round: 1, answer: 'Stub decision option-a confirmed', cited_sources: ['decision_point:Stub decision'], confidence: 'high', recommended_action: 'plan-stands', ts: 't' }],
        { status: 'approved', reasoning: 'OK', cited_adrs: [], cited_principles: [], cited_lessons: [], requested_modifications: [], new_adrs_to_file: [], affected_existing_adrs: [] }
      ),
      signoffComposer: composer,
      generateSubmissionId: ((): (() => string) => { let i = 0; return (): string => { i++; return `concur-${i}-${Date.now()}`; }; })()
    });
    const subs: CoordinatorPlanSubmission[] = Array.from({ length: 3 }, (_, i) => ({
      planMarkdown: `# Plan ${i + 1}`, planType: 'research', callerAgentId: 't', submittedBy: 't',
      contextDump: makeStubContextDump({ plan_slug: `plan-${i + 1}` })
    }));
    const outcomes = await Promise.all(subs.map((s) => c.review(s)));
    expect(new Set(outcomes.map((o) => o.submissionId)).size).toBe(3);
    for (const o of outcomes) {
      expect(o.status).toBe('approved');
      expect(existsSync(o.signoffPath)).toBe(true);
    }
  }, 30_000);
});
