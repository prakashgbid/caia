import { describe, expect, it, vi } from 'vitest';

import { EaArchitectAgent } from '../src/agent.js';
import { InMemoryFsAdapter } from '../src/fs-adapter.js';
import { ESCALATION_SECTION_HEADER } from '../src/escalation.js';
import type { EaReviewEvent, PlanSubmission, PlanType } from '../src/types.js';

import {
  AGENT_MEMORY_ROOT,
  INBOX_PATH,
  REPO_ROOT,
  sampleRepoFiles
} from './fixtures/sample-repository.js';
import { FixedCritic, makeOutput, StubCritic } from './fixtures/stub-critic.js';

const PLAN_TYPES: PlanType[] = [
  'research',
  'spec',
  'implementation',
  'architecture-change',
  'process-change'
];

function makeAgent(opts: { critic?: import('../src/types.js').CriticAdapter; fs?: InMemoryFsAdapter } = {}) {
  const fs = opts.fs ?? new InMemoryFsAdapter(sampleRepoFiles());
  const critic = opts.critic ?? new FixedCritic(makeOutput({ status: 'approved' }));
  let counter = 0;
  const agent = new EaArchitectAgent({
    repositoryPath: REPO_ROOT,
    inboxPath: INBOX_PATH,
    agentMemoryPath: AGENT_MEMORY_ROOT,
    critic,
    fs,
    clock: () => new Date('2026-05-23T12:00:00Z'),
    generateSubmissionId: () => {
      counter += 1;
      return `sub-${counter}`;
    }
  });
  return { agent, fs };
}

function makePlan(overrides: Partial<PlanSubmission> = {}): PlanSubmission {
  return {
    planMarkdown: 'We propose adding a small adapter.',
    planType: 'spec',
    callerAgentId: '@caia/researcher',
    submittedBy: 'orchestrator',
    affectedComponents: ['@caia/atlas-mapper'],
    ...overrides
  };
}

describe('EaArchitectAgent — basic flow', () => {
  it('approves a sound plan with no new ADRs', async () => {
    const { agent } = makeAgent();
    const out = await agent.submitPlan(makePlan());
    expect(out.status).toBe('approved');
    expect(out.submissionId).toBe('sub-1');
    expect(out.iteration).toBe(1);
    expect(out.modelTier).toBe('sonnet');
    expect(agent.getCurrentState('sub-1')).toBe('ea-review-approved');
  });

  it('rejects a plan and emits the rejected event', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'rejected',
        reasoning: 'violates P1 — proposes API key billing',
        cited_principles: ['P1']
      })
    );
    const { agent } = makeAgent({ critic });
    const events: EaReviewEvent[] = [];
    agent.on('*', (e) => {
      events.push(e);
    });
    const out = await agent.submitPlan(makePlan());
    expect(out.status).toBe('rejected');
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('ea-architect.review.rejected');
    expect(events[0]?.toState).toBe('ea-review-rejected');
  });

  it('emits a "needs-clarification" plan as revisions-requested', async () => {
    const critic = new FixedCritic(
      makeOutput({ status: 'needs-clarification', reasoning: 'plan unclear' })
    );
    const { agent } = makeAgent({ critic });
    const out = await agent.submitPlan(makePlan());
    expect(out.status).toBe('needs-clarification');
    expect(agent.getCurrentState('sub-1')).toBe('ea-review-revisions-requested');
  });

  it('honors caller-provided submissionId', async () => {
    const { agent } = makeAgent();
    const out = await agent.submitPlan(
      makePlan({ submissionId: 'my-custom-id' })
    );
    expect(out.submissionId).toBe('my-custom-id');
  });

  it('escalates with an INBOX entry when LLM flags strategic escalation', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved',
        reasoning: 'pivot detected',
        escalation_to_operator: {
          reason: 'product pivot',
          decisionPoint: 'pivot to B2C',
          category: 'product-pivot'
        }
      })
    );
    const { agent, fs } = makeAgent({ critic });
    const out = await agent.submitPlan(makePlan());
    expect(out.escalation_to_operator?.category).toBe('product-pivot');
    expect(agent.getCurrentState(out.submissionId)).toBe('ea-review-escalated-to-operator');
    expect(fs.has(INBOX_PATH)).toBe(true);
    const inbox = fs.readFile(INBOX_PATH);
    expect(inbox).toContain(ESCALATION_SECTION_HEADER);
    expect(inbox).toContain('product-pivot');
  });

  it('escalates via keyword fallback when LLM did not flag', async () => {
    const critic = new FixedCritic(makeOutput({ status: 'approved' }));
    const { agent, fs } = makeAgent({ critic });
    const out = await agent.submitPlan(
      makePlan({ planMarkdown: 'We propose a product pivot to B2C.' })
    );
    expect(out.escalation_to_operator).toBeDefined();
    expect(out.escalation_to_operator?.category).toBe('product-pivot');
    expect(fs.has(INBOX_PATH)).toBe(true);
  });

  it('does NOT escalate routine technical plans', async () => {
    const { agent, fs } = makeAgent();
    const out = await agent.submitPlan(
      makePlan({ planMarkdown: 'Add a new endpoint /api/health.' })
    );
    expect(out.escalation_to_operator).toBeUndefined();
    expect(fs.has(INBOX_PATH)).toBe(false);
  });
});

describe('EaArchitectAgent — plan types', () => {
  for (const planType of PLAN_TYPES) {
    it(`accepts planType="${planType}" and processes it`, async () => {
      const { agent } = makeAgent();
      const out = await agent.submitPlan(makePlan({ planType }));
      expect(out.status).toBe('approved');
    });
  }

  it('picks Opus tier for architecture-change planType', async () => {
    const { agent } = makeAgent();
    const out = await agent.submitPlan(makePlan({ planType: 'architecture-change' }));
    expect(out.modelTier).toBe('opus');
  });

  it('picks Opus when 5+ affected components', async () => {
    const { agent } = makeAgent();
    const out = await agent.submitPlan(
      makePlan({ affectedComponents: ['a', 'b', 'c', 'd', 'e', 'f'] })
    );
    expect(out.modelTier).toBe('opus');
  });

  it('picks Opus for very long plans', async () => {
    const big = 'word '.repeat(6000);
    const { agent } = makeAgent();
    const out = await agent.submitPlan(makePlan({ planMarkdown: big }));
    expect(out.modelTier).toBe('opus');
  });
});

describe('EaArchitectAgent — ADR auto-filing', () => {
  it('files a new ADR on approval and gives it next number', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved',
        new_adrs_to_file: [
          {
            title: 'Adopt the X pattern',
            status: 'Accepted',
            context: 'context',
            decision: 'decision',
            consequences: 'consequences',
            affectedComponents: ['@caia/x']
          }
        ]
      })
    );
    const { agent, fs } = makeAgent({ critic });
    await agent.submitPlan(makePlan());
    // Sample repo has 61 ADRs so next is ADR-062.
    const expectedPath = `${REPO_ROOT}/decisions/ADR-062-adopt-the-x-pattern.md`;
    expect(fs.has(expectedPath)).toBe(true);
    const body = fs.readFile(expectedPath);
    expect(body).toContain('# ADR-062 — Adopt the X pattern');
    expect(body).toContain('- **Affected-components:** @caia/x');
  });

  it('wires supersession on both sides', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved',
        new_adrs_to_file: [
          {
            title: 'Replace MUI with shadcn',
            status: 'Accepted',
            context: 'c',
            decision: 'd',
            consequences: 'e',
            supersedes: ['ADR-060']
          }
        ],
        affected_existing_adrs: [{ adrId: 'ADR-060', action: 'supersede' }]
      })
    );
    const { agent, fs } = makeAgent({ critic });
    await agent.submitPlan(makePlan());
    const adr060Path = `${REPO_ROOT}/decisions/ADR-060-mui-react-first-stack.md`;
    const body = fs.readFile(adr060Path);
    expect(body).toContain('ADR-062');
  });

  it('updates INDEX.md after filing', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved',
        new_adrs_to_file: [
          {
            title: 'Trivial decision',
            status: 'Accepted',
            context: 'c',
            decision: 'd',
            consequences: 'e'
          }
        ]
      })
    );
    const { agent, fs } = makeAgent({ critic });
    await agent.submitPlan(makePlan());
    expect(fs.has(`${REPO_ROOT}/decisions/INDEX.md`)).toBe(true);
    expect(fs.readFile(`${REPO_ROOT}/decisions/INDEX.md`)).toContain('ADR-062');
  });

  it('does NOT file ADRs on rejection', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'rejected',
        new_adrs_to_file: [
          {
            title: 'Should not be filed',
            status: 'Accepted',
            context: 'c',
            decision: 'd',
            consequences: 'e'
          }
        ]
      })
    );
    const { agent, fs } = makeAgent({ critic });
    await agent.submitPlan(makePlan());
    expect(fs.has(`${REPO_ROOT}/decisions/ADR-062-should-not-be-filed.md`)).toBe(false);
  });
});

describe('EaArchitectAgent — iteration loop', () => {
  it('approved-with-modifications goes to revisions-requested on iteration 1', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved-with-modifications',
        requested_modifications: ['fix X', 'document Y']
      })
    );
    const { agent } = makeAgent({ critic });
    const out = await agent.submitPlan(makePlan());
    expect(out.requested_modifications).toEqual(['fix X', 'document Y']);
    expect(agent.getCurrentState(out.submissionId)).toBe('ea-review-revisions-requested');
  });

  it('caller can resubmit with same submissionId; iteration bumps', async () => {
    const critic = new StubCritic([
      makeOutput({ status: 'approved-with-modifications', requested_modifications: ['fix X'] }),
      makeOutput({ status: 'approved' })
    ]);
    const { agent } = makeAgent({ critic });
    const out1 = await agent.submitPlan(makePlan({ submissionId: 'shared' }));
    expect(out1.iteration).toBe(1);
    expect(agent.getCurrentState('shared')).toBe('ea-review-revisions-requested');
    const out2 = await agent.submitPlan(makePlan({ submissionId: 'shared' }));
    expect(out2.iteration).toBe(2);
    expect(out2.status).toBe('approved');
    expect(agent.getCurrentState('shared')).toBe('ea-review-approved');
  });

  it('throws when resubmitting a terminal submission', async () => {
    const { agent } = makeAgent();
    await agent.submitPlan(makePlan({ submissionId: 'terminal' }));
    expect(agent.getCurrentState('terminal')).toBe('ea-review-approved');
    await expect(agent.submitPlan(makePlan({ submissionId: 'terminal' }))).rejects.toThrow(
      /terminal state/
    );
  });

  it('locks to conditional-approval at iteration 3 if still modifications-requested', async () => {
    const critic = new FixedCritic(
      makeOutput({ status: 'approved-with-modifications', requested_modifications: ['x'] })
    );
    const { agent } = makeAgent({ critic });
    await agent.submitPlan(makePlan({ submissionId: 'loop' }));
    await agent.submitPlan(makePlan({ submissionId: 'loop' }));
    const out3 = await agent.submitPlan(makePlan({ submissionId: 'loop' }));
    expect(out3.iteration).toBe(3);
    expect(agent.getCurrentState('loop')).toBe('ea-review-conditional-approval');
  });
});

describe('EaArchitectAgent — history + events', () => {
  it('getReviewHistory: returns null for unknown submission', () => {
    const { agent } = makeAgent();
    expect(agent.getReviewHistory('not-real')).toBeNull();
  });

  it('getReviewHistory: returns the entries with transition state', async () => {
    const critic = new StubCritic([
      makeOutput({ status: 'approved-with-modifications', requested_modifications: ['fix'] }),
      makeOutput({ status: 'approved' })
    ]);
    const { agent } = makeAgent({ critic });
    await agent.submitPlan(makePlan({ submissionId: 'hist' }));
    await agent.submitPlan(makePlan({ submissionId: 'hist' }));
    const hist = agent.getReviewHistory('hist');
    expect(hist?.entries.length).toBe(2);
    expect(hist?.entries[0]?.transitionTo).toBe('ea-review-revisions-requested');
    expect(hist?.entries[1]?.transitionTo).toBe('ea-review-approved');
    expect(hist?.currentState).toBe('ea-review-approved');
  });

  it('listSubmissions: returns all known submission ids', async () => {
    const { agent } = makeAgent();
    await agent.submitPlan(makePlan());
    await agent.submitPlan(makePlan());
    expect(agent.listSubmissions().length).toBe(2);
  });

  it('emits state-transition events on every review pass', async () => {
    const critic = new StubCritic([
      makeOutput({ status: 'approved-with-modifications', requested_modifications: ['x'] }),
      makeOutput({ status: 'rejected', reasoning: 'no' })
    ]);
    const { agent } = makeAgent({ critic });
    const events: EaReviewEvent[] = [];
    agent.on('*', (e) => {
      events.push(e);
    });
    await agent.submitPlan(makePlan({ submissionId: 'evts' }));
    await agent.submitPlan(makePlan({ submissionId: 'evts' }));
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('ea-architect.review.revisions-requested');
    expect(events[1]?.type).toBe('ea-architect.review.rejected');
  });

  it('event subscribers can filter by exact type', async () => {
    const { agent } = makeAgent();
    const approvedHandler = vi.fn();
    agent.on('ea-architect.review.approved', approvedHandler);
    await agent.submitPlan(makePlan());
    expect(approvedHandler).toHaveBeenCalledOnce();
  });
});

describe('EaArchitectAgent — hallucination guard', () => {
  it('drops fabricated ADR citations before returning to caller', async () => {
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved',
        cited_adrs: ['ADR-001', 'ADR-999', 'ADR-9999'],
        cited_principles: ['P1', 'P999']
      })
    );
    const { agent } = makeAgent({ critic });
    const out = await agent.submitPlan(makePlan());
    expect(out.cited_adrs).toEqual(['ADR-001']);
    expect(out.cited_principles).toEqual(['P1']);
  });
});
