/**
 * Per-agent regression — EA Agent.
 *
 * Asserts the EA Agent's contract (post-ARCH-006: EA runs after BA):
 *   - Every story gets a tech_sub_domain_primary classification.
 *   - Risk + effort are inferred (canonical enum values).
 *   - The `ea-agent.classification.complete` event fires.
 *   - `ea_decomposed` pipeline stage is reached.
 *   - Mutual-exclusion violations (effort=XL, risk=critical without
 *     P0/P1, lifecycle=spike with effort>M) are caught and the
 *     story's templateValidationStatus is flipped to invalid.
 */

import { eq } from 'drizzle-orm';
import { stories, events, promptPipelineStages } from '../../../src/db/schema';
import { createTestDb, wireBusToTestDb } from '../_helpers/db';
import { drivePipeline } from '../_helpers/pipeline';
import {
  inferTechSubDomains,
  inferRisk,
  inferEffort,
  validateTaxonomyInvariants,
} from '../../../src/agents/ea-agent';

describe('Per-agent regression — EA Agent', () => {
  it('classifies every story with a tech sub-domain + risk + effort', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_ea_classify',
        promptBody: 'add a Stripe payment integration with webhooks',
        stopAfter: 'ea_decomposed',
      },
      db,
    );

    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_ea_classify'))
      .all();
    expect(storyRows.length).toBeGreaterThan(0);

    for (const s of storyRows) {
      expect(s.techSubDomainPrimary).toBeTruthy();
      expect(['low', 'medium', 'high', 'critical']).toContain(s.risk);
      expect(['XS', 'S', 'M', 'L', 'XL']).toContain(s.effort);
    }
  }, 60_000);

  it('advances pipeline to ea_decomposed + fires classification event', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_ea_event',
        promptBody: 'add a search bar to the home page',
        stopAfter: 'ea_decomposed',
      },
      db,
    );

    const stageRow = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.stage, 'ea_decomposed'))
      .all()
      .find((r) => r.promptId === 'prm_ea_event');
    expect(stageRow).toBeTruthy();

    const decompose = db
      .select()
      .from(events)
      .where(eq(events.type, 'ea-agent.classification.complete'))
      .all()
      .find((e) => e.correlationId === 'prm_ea_event');
    expect(decompose).toBeTruthy();
  }, 60_000);

  // ─── Pure-function regressions (no DB required) ─────────────────────────

  it('inferTechSubDomains seeds primaryDomain and accumulates keyword hits', () => {
    const { primary, all } = inferTechSubDomains(
      'add a Stripe checkout with webhook handler',
      'api-integration',
    );
    expect(['payments', 'bff', 'backend']).toContain(primary);
    expect(all).toContain(primary);
  });

  it('inferRisk lifts payments + auth + database tech to high risk', () => {
    expect(inferRisk(['payments'], [], null)).toBe('high');
    expect(inferRisk(['auth'], [], null)).toBe('high');
    expect(inferRisk(['database'], [], null)).toBe('high');
    expect(inferRisk(['data-migration'], [], null)).toBe('critical');
    expect(inferRisk(['frontend'], [], null)).toBe('medium');
    expect(inferRisk(['frontend'], [], 'docs')).toBe('low');
  });

  it('inferEffort respects the classifier complexity mapping', () => {
    expect(inferEffort('one liner', 'trivial')).toBe('XS');
    expect(inferEffort('multi-paragraph', 'large')).toBe('L');
    expect(inferEffort('massive', 'xl')).toBe('XL');
  });

  it('validateTaxonomyInvariants enforces effort=XL split + critical/P0 + spike/M', () => {
    expect(
      validateTaxonomyInvariants({
        effort: 'XL',
        risk: 'medium',
        priorityBucket: 'P2',
        lifecycle: 'new',
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateTaxonomyInvariants({
        effort: 'M',
        risk: 'critical',
        priorityBucket: 'P3',
        lifecycle: 'new',
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateTaxonomyInvariants({
        effort: 'L',
        risk: 'medium',
        priorityBucket: 'P2',
        lifecycle: 'spike',
      }).length,
    ).toBeGreaterThan(0);
    // Conformant invariants — no violations.
    expect(
      validateTaxonomyInvariants({
        effort: 'M',
        risk: 'critical',
        priorityBucket: 'P0',
        lifecycle: 'new',
      }),
    ).toEqual([]);
  });
});
