/**
 * Golden tests — three real-shaped plans exercise the end-to-end
 * verdict pipeline.
 *
 * We stub the critic so the test is deterministic, but the critic
 * outputs are hand-crafted to match what the real model would (and
 * should) emit for each plan. The assertions verify the agent's
 * behaviour AROUND the critic — repository loading, ADR auto-filing,
 * supersession wiring, INDEX.md updates, hallucination guarding,
 * state transitions, event emission, INBOX-escalation surfacing.
 */

import { describe, expect, it } from 'vitest';

import { EaArchitectAgent } from '../src/agent.js';
import { InMemoryFsAdapter } from '../src/fs-adapter.js';
import type { EaReviewEvent } from '../src/types.js';

import {
  AGENT_MEMORY_ROOT,
  INBOX_PATH,
  REPO_ROOT,
  sampleRepoFiles
} from './fixtures/sample-repository.js';
import { BAD_PLAN_MD, GOOD_PLAN_MD, MODIFICATIONS_PLAN_MD } from './fixtures/plans.js';
import { FixedCritic, makeOutput } from './fixtures/stub-critic.js';

describe('golden: good plan → approved + ADR filed', () => {
  it('files ADR-062 with correct numbering and updates INDEX.md', async () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved',
        reasoning:
          'Plan aligns with ADR-029 conventions and P1/P11 (event-first). New ADR captures the namespace decision.',
        cited_adrs: ['ADR-001', 'ADR-015'],
        cited_principles: ['P1', 'P11' as never],
        cited_lessons: [],
        new_adrs_to_file: [
          {
            title: 'Adopt ea-architect dot namespace for review transitions',
            status: 'Accepted',
            context:
              'The EA Architect Agent emits state transitions. To match ADR-029 conventions we need a registered namespace.',
            decision:
              'Use ea-architect.review.<state> as the namespace and register it in events-taxonomy-internal.',
            consequences:
              'Positive: consistent dashboard filtering. Negative: registry ceremony.',
            affectedComponents: ['@caia/ea-architect', '@chiefaia/events-taxonomy-internal'],
            reversibility: 'Reversible'
          }
        ]
      })
    );
    const events: EaReviewEvent[] = [];
    const agent = new EaArchitectAgent({
      repositoryPath: REPO_ROOT,
      inboxPath: INBOX_PATH,
      agentMemoryPath: AGENT_MEMORY_ROOT,
      critic,
      fs,
      clock: () => new Date('2026-05-23T12:00:00Z'),
      generateSubmissionId: () => 'good-plan-1'
    });
    agent.on('*', (e) => {
      events.push(e);
    });

    const out = await agent.submitPlan({
      planMarkdown: GOOD_PLAN_MD,
      planType: 'spec',
      callerAgentId: '@caia/researcher',
      submittedBy: 'orchestrator',
      affectedComponents: ['@caia/ea-architect', '@chiefaia/events-taxonomy-internal']
    });

    // Verdict shape
    expect(out.status).toBe('approved');
    expect(out.submissionId).toBe('good-plan-1');
    expect(out.iteration).toBe(1);
    expect(out.cited_adrs).toContain('ADR-001');
    expect(out.cited_adrs).toContain('ADR-015');
    expect(out.cited_principles).toContain('P1');
    // P11 wasn't in fixture repo — hallucination guard drops it.
    expect(out.cited_principles).not.toContain('P11');

    // ADR filed on disk with correct number + slug
    const expected = `${REPO_ROOT}/decisions/ADR-062-adopt-ea-architect-dot-namespace-for-review-transitions.md`;
    expect(fs.has(expected)).toBe(true);
    const body = fs.readFile(expected);
    expect(body).toContain('# ADR-062');
    expect(body).toContain('- **Status:** Accepted');
    expect(body).toContain('- **Affected-components:** @caia/ea-architect, @chiefaia/events-taxonomy-internal');

    // INDEX.md updated
    expect(fs.has(`${REPO_ROOT}/decisions/INDEX.md`)).toBe(true);
    expect(fs.readFile(`${REPO_ROOT}/decisions/INDEX.md`)).toContain('ADR-062');

    // State transition + event
    expect(agent.getCurrentState('good-plan-1')).toBe('ea-review-approved');
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('ea-architect.review.approved');
  });
});

describe('golden: partial plan → approved-with-modifications', () => {
  it('returns specific modifications and transitions to revisions-requested', async () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const critic = new FixedCritic(
      makeOutput({
        status: 'approved-with-modifications',
        reasoning:
          'Cache concept is sound but the plan omits cache invalidation. Add an invalidation hook and cite ADR-029 for event-driven invalidation.',
        cited_adrs: ['ADR-029'],
        cited_principles: ['P9'],
        requested_modifications: [
          'Specify cache invalidation policy (TTL alone is insufficient when the repository changes).',
          'Cite ADR-029 — invalidate on repository write events.',
          'Add a benchmark plan to verify caching actually improves throughput.'
        ]
      })
    );
    const events: EaReviewEvent[] = [];
    const agent = new EaArchitectAgent({
      repositoryPath: REPO_ROOT,
      inboxPath: INBOX_PATH,
      agentMemoryPath: AGENT_MEMORY_ROOT,
      critic,
      fs,
      clock: () => new Date('2026-05-23T12:00:00Z'),
      generateSubmissionId: () => 'mods-plan-1'
    });
    agent.on('*', (e) => {
      events.push(e);
    });

    const out = await agent.submitPlan({
      planMarkdown: MODIFICATIONS_PLAN_MD,
      planType: 'spec',
      callerAgentId: '@caia/researcher',
      submittedBy: 'orchestrator',
      affectedComponents: ['@caia/ea-architect']
    });

    expect(out.status).toBe('approved-with-modifications');
    expect(out.requested_modifications?.length).toBe(3);
    expect(out.requested_modifications?.[0]).toMatch(/invalidation/);
    expect(out.cited_adrs).toContain('ADR-029');
    // Iteration 1 → revisions-requested (not conditional-approval)
    expect(agent.getCurrentState('mods-plan-1')).toBe('ea-review-revisions-requested');
    expect(events[0]?.type).toBe('ea-architect.review.revisions-requested');

    // Hard rule: never approves without updating documentation — verify
    // no ADR was filed on a non-terminal approval.
    expect(fs.has(`${REPO_ROOT}/decisions/INDEX.md`)).toBe(false);
  });
});

describe('golden: bad plan → rejected with cited principles', () => {
  it('cites P1 and emits rejected event without filing ADRs', async () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const critic = new FixedCritic(
      makeOutput({
        status: 'rejected',
        reasoning:
          'Plan violates P1 (subscription-only LLM during build) by setting ANTHROPIC_API_KEY and proposing pay-per-token billing. Also violates P3 (no timelines) by quoting "4 days". ADR-001 codifies the subscription rule. No new ADRs justified by this plan.',
        cited_adrs: ['ADR-001'],
        cited_principles: ['P1', 'P3'],
        cited_lessons: []
      })
    );
    const events: EaReviewEvent[] = [];
    const agent = new EaArchitectAgent({
      repositoryPath: REPO_ROOT,
      inboxPath: INBOX_PATH,
      agentMemoryPath: AGENT_MEMORY_ROOT,
      critic,
      fs,
      clock: () => new Date('2026-05-23T12:00:00Z'),
      generateSubmissionId: () => 'bad-plan-1'
    });
    agent.on('*', (e) => {
      events.push(e);
    });

    const out = await agent.submitPlan({
      planMarkdown: BAD_PLAN_MD,
      planType: 'implementation',
      callerAgentId: '@caia/researcher',
      submittedBy: 'orchestrator',
      affectedComponents: ['@caia/ea-architect']
    });

    expect(out.status).toBe('rejected');
    expect(out.reasoning).toContain('P1');
    expect(out.cited_principles).toContain('P1');
    expect(out.cited_principles).toContain('P3');
    expect(out.cited_adrs).toContain('ADR-001');

    // No ADR filed on rejection
    expect(fs.has(`${REPO_ROOT}/decisions/INDEX.md`)).toBe(false);

    // State transition + event
    expect(agent.getCurrentState('bad-plan-1')).toBe('ea-review-rejected');
    expect(events[0]?.type).toBe('ea-architect.review.rejected');
  });

  it('detects principle amendment in plan text via keyword fallback', async () => {
    // Even if the critic missed the escalation, the keyword detector should
    // flag "remove the no-timelines rule" as a principle amendment.
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const critic = new FixedCritic(
      makeOutput({
        status: 'rejected',
        reasoning: 'no',
        cited_principles: ['P1']
      })
    );
    const agent = new EaArchitectAgent({
      repositoryPath: REPO_ROOT,
      inboxPath: INBOX_PATH,
      agentMemoryPath: AGENT_MEMORY_ROOT,
      critic,
      fs,
      clock: () => new Date('2026-05-23T12:00:00Z'),
      generateSubmissionId: () => 'bad-plan-2'
    });

    const out = await agent.submitPlan({
      planMarkdown: 'We will amend principle P1 to permit API keys.',
      planType: 'process-change',
      callerAgentId: '@caia/researcher',
      submittedBy: 'orchestrator'
    });
    // Critic returned rejected; but the keyword fallback should add the
    // strategic escalation.
    expect(out.escalation_to_operator?.category).toBe('principle-amendment');
    expect(agent.getCurrentState('bad-plan-2')).toBe('ea-review-escalated-to-operator');
    // INBOX got the entry
    expect(fs.has(INBOX_PATH)).toBe(true);
    expect(fs.readFile(INBOX_PATH)).toContain('principle-amendment');
  });
});
