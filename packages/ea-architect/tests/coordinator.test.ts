/**
 * EaCoordinator unit tests — routing, aggregation, sign-off composition.
 *
 * Sub-agents are stubbed; we test the Coordinator's orchestration logic
 * in isolation. End-to-end against real adapters is covered by the smoke
 * test.
 */

import { describe, expect, it } from 'vitest';

import {
  EaCoordinator,
  InMemoryFsAdapter,
  ValidationFailure,
  aggregateVerdicts,
  computeReadTimeMinutes,
  pickDominantVerdict,
  routeFor
} from '../src/index.js';
import type {
  CoordinatorPlanSubmission,
  PlanReviewerAdapter,
  SubAgentVerdict,
  TicketAuditorAdapter
} from '../src/index.js';

const baseSubmission: CoordinatorPlanSubmission = {
  planMarkdown: '# Plan\n\nSome plan content.',
  planType: 'research',
  callerAgentId: '@caia/researcher',
  submittedBy: 'tests',
  contextDump: {
    schema_version: 1,
    plan_path: '/tmp/plan.md',
    plan_slug: 'plan',
    producer_agent_id: 'tests',
    producer_session_id: 's',
    produced_at: '2026-05-24T00:00:00.000Z',
    models_used: ['sonnet'],
    reasoning_summary: 'word '.repeat(200).trim(),
    decision_points: [],
    sources_consulted: [],
    open_questions: [],
    alternatives_dropped: [],
    invitations_to_scrutiny: [],
    assumptions: []
  }
};

class StubReviewer implements PlanReviewerAdapter {
  constructor(private readonly verdict: SubAgentVerdict) {}
  async review(): Promise<SubAgentVerdict> {
    return this.verdict;
  }
}

class StubAuditor implements TicketAuditorAdapter {
  constructor(private readonly verdict: SubAgentVerdict) {}
  audit(): SubAgentVerdict {
    return this.verdict;
  }
}

function reviewerApproved(): SubAgentVerdict {
  return {
    subAgent: 'ea-plan-reviewer',
    status: 'approved',
    reasoning: 'Plan aligns with principles P1, P9; cited ADR-015.',
    cited_principles: ['P1', 'P9'],
    cited_adrs: ['ADR-015'],
    defenderRoundsUsed: 0,
    dialogue: [],
    ranAtIso: '2026-05-24T01:00:00.000Z'
  };
}

describe('routeFor', () => {
  it('routes research → ea-plan-reviewer', () => {
    expect(routeFor('research')).toEqual(['ea-plan-reviewer']);
  });
  it('routes implementation-plan → reviewer + ticket-auditor', () => {
    expect(routeFor('implementation-plan')).toEqual(['ea-plan-reviewer', 'ea-ticket-auditor']);
  });
  it('routes drift-alert → drift-sentinel only', () => {
    expect(routeFor('drift-alert')).toEqual(['ea-drift-sentinel']);
  });
});

describe('pickDominantVerdict', () => {
  it('picks the only verdict if just one', () => {
    const v = reviewerApproved();
    const { dominant, dissenting } = pickDominantVerdict([v]);
    expect(dominant).toBe(v);
    expect(dissenting).toEqual([]);
  });

  it('picks rejected over approved across sub-agents', () => {
    const reviewer = reviewerApproved();
    const auditor: SubAgentVerdict = {
      subAgent: 'ea-ticket-auditor',
      status: 'rejected',
      reasoning: 'Ticket missing acceptance criteria',
      ranAtIso: '2026-05-24T01:00:00.000Z'
    };
    const { dominant, dissenting } = pickDominantVerdict([reviewer, auditor]);
    expect(dominant.subAgent).toBe('ea-ticket-auditor');
    expect(dissenting[0]?.subAgent).toBe('ea-plan-reviewer');
  });

  it('advisory verdicts never count as dissent', () => {
    const reviewer = reviewerApproved();
    const advisory: SubAgentVerdict = {
      subAgent: 'ea-research-conductor',
      status: 'advisory',
      reasoning: 'Recommend further research',
      ranAtIso: '2026-05-24T01:00:00.000Z'
    };
    const { dominant, dissenting } = pickDominantVerdict([reviewer, advisory]);
    expect(dominant.subAgent).toBe('ea-plan-reviewer');
    expect(dissenting).toEqual([]);
  });
});

describe('aggregateVerdicts', () => {
  it('composes citations across verdicts', () => {
    const v1: SubAgentVerdict = { ...reviewerApproved(), cited_adrs: ['ADR-001', 'ADR-002'] };
    const v2: SubAgentVerdict = {
      subAgent: 'ea-ticket-auditor',
      status: 'approved',
      reasoning: 'Ticket complete',
      cited_adrs: ['ADR-002', 'ADR-003'],
      ranAtIso: '2026-05-24T01:00:00.000Z'
    };
    const out = aggregateVerdicts({
      submissionId: 's',
      iteration: 1,
      verdicts: [v1, v2],
      reviewedAtIso: '2026-05-24T01:00:00.000Z',
      signoffPath: '/tmp/sign.md'
    });
    expect(out.cited_adrs.sort()).toEqual(['ADR-001', 'ADR-002', 'ADR-003']);
  });
});

describe('computeReadTimeMinutes', () => {
  it('returns 1+ minute for small docs', () => {
    expect(computeReadTimeMinutes({ wordCount: 100, subAgentsInvoked: 1, defenderRounds: 0, newAdrs: 0 })).toBeGreaterThanOrEqual(1);
  });
  it('caps at 30', () => {
    expect(computeReadTimeMinutes({ wordCount: 100000, subAgentsInvoked: 10, defenderRounds: 5, newAdrs: 20 })).toBe(30);
  });
});

describe('EaCoordinator.validateSubmission', () => {
  it('rejects research without context dump', () => {
    const fs = new InMemoryFsAdapter({
      '/tmp/caia-ea/decisions/INDEX.md': '# index',
      '/tmp/caia-ea/principles/00-architecture-principles.md': '## P1 — Test\nstatement.'
    });
    const c = new EaCoordinator({
      fs,
      repositoryPath: '/tmp/caia-ea',
      inboxPath: '/tmp/agent-memory/INBOX.md',
      agentMemoryPath: '/tmp/agent-memory'
    });
    const result = c.validateSubmission({
      ...baseSubmission,
      contextDump: undefined,
      contextDumpPath: undefined
    } as CoordinatorPlanSubmission);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('needs-context-dump');
  });

  it('accepts research with inline context dump', () => {
    const c = new EaCoordinator({
      fs: new InMemoryFsAdapter({}),
      repositoryPath: '/tmp/caia-ea',
      inboxPath: '/tmp/agent-memory/INBOX.md',
      agentMemoryPath: '/tmp/agent-memory'
    });
    expect(c.validateSubmission(baseSubmission).ok).toBe(true);
  });

  it('rejects unknown plan type', () => {
    const c = new EaCoordinator({
      fs: new InMemoryFsAdapter({}),
      repositoryPath: '/tmp/caia-ea',
      inboxPath: '/tmp/agent-memory/INBOX.md',
      agentMemoryPath: '/tmp/agent-memory'
    });
    const r = c.validateSubmission({ ...baseSubmission, planType: 'unknown-type' as never });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown-plan-type');
  });
});

describe('EaCoordinator.review end-to-end with stub reviewer', () => {
  it('routes, invokes reviewer, composes sign-off', async () => {
    const fs = new InMemoryFsAdapter({});
    const c = new EaCoordinator({
      fs,
      repositoryPath: '/tmp/caia-ea',
      inboxPath: '/tmp/agent-memory/INBOX.md',
      agentMemoryPath: '/tmp/agent-memory',
      planReviewer: new StubReviewer(reviewerApproved()),
      generateSubmissionId: ((): (() => string) => {
        let i = 0;
        return (): string => {
          i += 1;
          return `s-${i}`;
        };
      })()
    });
    const outcome = await c.review(baseSubmission);
    expect(outcome.status).toBe('approved');
    expect(outcome.subAgentsInvoked).toEqual(['ea-plan-reviewer']);
    expect(outcome.signoffPath).toContain('s-1.md');
    // Sign-off was written.
    const written = fs.get(outcome.signoffPath);
    expect(written).toBeDefined();
    expect(written).toContain('# EA Sign-Off');
    expect(written).toContain('TL;DR');
    expect(written).toContain('approved');
  });

  it('invokes both reviewer and ticket-auditor for implementation-plan', async () => {
    const fs = new InMemoryFsAdapter({});
    const auditor = new StubAuditor({
      subAgent: 'ea-ticket-auditor',
      status: 'pass',
      reasoning: 'Ticket fully covered',
      ticketAudit: {
        ticketId: 'T-1',
        completenessScore: 1,
        missingNonFunctional: [],
        dodResults: []
      },
      ranAtIso: '2026-05-24T01:00:00.000Z'
    });
    const c = new EaCoordinator({
      fs,
      repositoryPath: '/tmp/caia-ea',
      inboxPath: '/tmp/agent-memory/INBOX.md',
      agentMemoryPath: '/tmp/agent-memory',
      planReviewer: new StubReviewer(reviewerApproved()),
      ticketAuditor: auditor,
      generateSubmissionId: ((): (() => string) => {
        let i = 0;
        return (): string => {
          i += 1;
          return `s-${i}`;
        };
      })()
    });
    const outcome = await c.review({ ...baseSubmission, planType: 'implementation-plan' });
    expect(outcome.subAgentsInvoked).toEqual(['ea-plan-reviewer', 'ea-ticket-auditor']);
    expect(outcome.subAgentVerdicts.length).toBe(2);
  });

  it('throws ValidationFailure on missing context dump', async () => {
    const c = new EaCoordinator({
      fs: new InMemoryFsAdapter({}),
      repositoryPath: '/tmp/caia-ea',
      inboxPath: '/tmp/agent-memory/INBOX.md',
      agentMemoryPath: '/tmp/agent-memory',
      planReviewer: new StubReviewer(reviewerApproved())
    });
    await expect(
      c.review({ ...baseSubmission, contextDump: undefined, contextDumpPath: undefined } as CoordinatorPlanSubmission)
    ).rejects.toBeInstanceOf(ValidationFailure);
  });
});
