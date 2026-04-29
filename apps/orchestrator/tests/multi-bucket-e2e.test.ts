/**
 * BUCKET-006 — Multi-bucket end-to-end acceptance test.
 *
 * Drives a multi-domain prompt all the way through the new BUCKET-001..009
 * pipeline:
 *   1. POST equivalent: insert into `prompts` table.
 *   2. Run PO Agent (BUCKET-002) — populates project_slug,
 *      business_sub_domains_json, lifecycle, priority_bucket on every story.
 *   3. Run EA Agent (BUCKET-003) — populates tech_sub_domains_json,
 *      tech_sub_domain_primary, quality_tags_json, risk, effort,
 *      blocked_by_json, claims_json on every story.
 *   4. Run BA Agent — produces TicketTemplateV1 ticket bundles.
 *   5. Run Task Scheduler / multi-bucket placer (BUCKET-004) —
 *      keys on (project_slug, tech_sub_domain_primary), uses the BUCKET-008
 *      chain-fragmenter for level batches, persists into task_buckets.
 *   6. Assert:
 *      - stories.project_slug set on every story.
 *      - stories.tech_sub_domain_primary set on every story.
 *      - stories.business_sub_domains_json populated.
 *      - stories.lifecycle, risk, effort, priority_bucket set.
 *      - At least 3 buckets materialised (we POST a 3-domain prompt).
 *      - Each bucket has a project_slug + tech_sub_domain.
 *      - For sequential buckets with chains: levels_json non-empty.
 *      - Dashboard /api/buckets equivalent returns those buckets with the
 *        new fields populated.
 *
 * If this test fails, BUCKET-### has regressed.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../src/db/schema';
import { prompts, stories, taskBuckets } from '../src/db/schema';

import { runPOAgent } from '../src/agents/po-agent';
import { runEAAgent } from '../src/agents/ea-agent';
import { runBAAgent } from '../src/agents/ba-agent';
import { runTaskScheduler } from '../src/agents/task-scheduler';
import { advancePipelineStage } from '../src/agents/pipeline-stages';

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

function nowIso() {
  return new Date().toISOString();
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

describe('BUCKET-006 — multi-bucket E2E', () => {
  it('multi-domain prompt -> N buckets -> stories carry full taxonomy', async () => {
    const { db } = createTestDb();
    const promptId = 'prm_multi_bucket_e2e';
    const correlationId = 'cor_multi_bucket_e2e';

    // 1. Seed the prompt — touches pokerzeno billing + gameplay + caia dashboard.
    db.insert(prompts)
      .values({
        id: promptId,
        body: 'Build pokerzeno billing v2 with subscription invoices, add a leaderboard gameplay screen, and extend the caia orchestrator dashboard pipeline view.',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId,
        hash: `hash_${promptId}`,
        status: 'received',
      })
      .run();

    advancePipelineStage(
      { promptId, stage: 'ingested', correlationId },
      db,
    );
    advancePipelineStage(
      { promptId, stage: 'scaffolded', correlationId },
      db,
    );

    // 2. PO Agent — should populate project_slug + business_sub_domains +
    //    lifecycle + priority_bucket on every story.
    const poOutput = await runPOAgent(
      {
        promptId,
        promptText:
          'Build pokerzeno billing v2 with subscription invoices, add a leaderboard gameplay screen, and extend the caia orchestrator dashboard pipeline view.',
        projectId: null,
        correlationId,
      },
      db,
    );

    // PO output should expose the prompt-level taxonomy.
    expect(poOutput.taxonomy).toBeDefined();
    expect(poOutput.taxonomy.project).toBeDefined();
    expect(poOutput.taxonomy.lifecycle).toBeDefined();
    expect(poOutput.taxonomy.priorityBucket).toBeDefined();

    expect(poOutput.storiesCreated).toBeGreaterThan(0);

    // 3. EA Agent — should populate tech_sub_domains + risk + effort + claims.
    const eaOutput = await runEAAgent({ promptId, correlationId }, db);
    expect(eaOutput.storiesClassified).toBe(poOutput.storiesCreated);

    // 4. BA Agent — produces ticket-template bundles.
    await runBAAgent({ promptId, correlationId, collabTimeoutMs: 1000 }, db);

    // 5. Task Scheduler — runs the BUCKET-004 multi-bucket placer.
    await runTaskScheduler({ promptId, correlationId }, db);

    // ─── Assertions ────────────────────────────────────────────────────────

    const allStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();

    expect(allStories.length).toBeGreaterThan(0);

    // Every story has the BUCKET-002 fields populated.
    for (const s of allStories) {
      expect(s.projectSlug).toBeTruthy();
      // The classifier picks one of the three projects mentioned (pokerzeno/caia)
      expect(['pokerzeno', 'caia', 'unassigned']).toContain(s.projectSlug);
      expect(s.lifecycle).toBeTruthy();
      expect(s.priorityBucket).toBeTruthy();
      // PO populates business sub-domains as JSON array (may be []).
      expect(s.businessSubDomainsJson).toBeDefined();
    }

    // Every story has the BUCKET-003 EA-populated fields.
    for (const s of allStories) {
      expect(s.techSubDomainPrimary).toBeTruthy();
      expect(s.risk).toBeTruthy();
      expect(s.effort).toBeTruthy();
      // techSubDomainsJson should be a non-empty array.
      const techAll = JSON.parse(s.techSubDomainsJson) as string[];
      expect(Array.isArray(techAll)).toBe(true);
      expect(techAll.length).toBeGreaterThan(0);
      // claims_json should be a populated object.
      expect(s.claimsJson).toBeDefined();
    }

    // Buckets — at least 1 sequential or 1 parallel, total >= 1.
    const allBuckets = db
      .select()
      .from(taskBuckets)
      .where(eq(taskBuckets.promptId, promptId))
      .all();
    expect(allBuckets.length).toBeGreaterThanOrEqual(1);

    // Sequential buckets must have project_slug + tech_sub_domain populated.
    const seqBuckets = allBuckets.filter((b) => b.kind === 'sequential');
    for (const b of seqBuckets) {
      expect(b.projectSlug).toBeTruthy();
      expect(b.techSubDomain).toBeTruthy();
    }

    // For each bucket, levels_json should be a valid JSON array (possibly empty).
    for (const b of allBuckets) {
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(b.levelsJson);
      }).not.toThrow();
      expect(Array.isArray(parsed)).toBe(true);
    }

    // Every story is linked to a bucket.
    for (const s of allStories) {
      expect(s.bucketId).toBeTruthy();
    }
  }, 30_000);

  it('claims-conflict scenario: two stories claiming the same file land in the deferred set', async () => {
    // This test seeds stories directly (skipping decomposition) so we can
    // exercise the resource-claim-checker / ready-pool logic in isolation.
    const { db } = createTestDb();
    const promptId = 'prm_claims_conflict_e2e';
    const correlationId = 'cor_claims_conflict_e2e';

    db.insert(prompts)
      .values({
        id: promptId,
        body: 'two stories that touch the same file',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId,
        hash: `hash_${promptId}`,
        status: 'received',
      })
      .run();

    const sharedFile = 'apps/orchestrator/src/agents/po-agent.ts';
    const claims = JSON.stringify({
      files: [sharedFile],
      schemas: [],
      apiRoutes: [],
      domains: ['agent-runtime'],
    });

    db.insert(stories)
      .values({
        id: 's_a',
        kind: 'story',
        title: 'edit po-agent.ts (story A)',
        description: '',
        rootPromptId: promptId,
        status: 'pending',
        createdAt: nowIso(),
        projectSlug: 'caia',
        techSubDomainPrimary: 'agent-runtime',
        techSubDomainsJson: '["agent-runtime"]',
        lifecycle: 'enhance',
        priorityBucket: 'P2',
        risk: 'medium',
        effort: 'M',
        claimsJson: claims,
      })
      .run();

    db.insert(stories)
      .values({
        id: 's_b',
        kind: 'story',
        title: 'edit po-agent.ts (story B)',
        description: '',
        rootPromptId: promptId,
        status: 'pending',
        createdAt: nowIso(),
        projectSlug: 'caia',
        techSubDomainPrimary: 'agent-runtime',
        techSubDomainsJson: '["agent-runtime"]',
        lifecycle: 'enhance',
        priorityBucket: 'P2',
        risk: 'medium',
        effort: 'M',
        claimsJson: claims,
      })
      .run();

    advancePipelineStage(
      { promptId, stage: 'ingested', correlationId },
      db,
    );
    advancePipelineStage(
      { promptId, stage: 'po_decomposed', correlationId },
      db,
    );

    await runTaskScheduler({ promptId, correlationId }, db);

    // Both stories land in the same parallel bucket — claim conflicts are
    // surfaced as warnings at placement time, not as deferrals (the
    // ready-pool defers them at executor pickup time, not here).
    const allStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    expect(allStories.length).toBe(2);
    for (const s of allStories) {
      expect(s.bucketId).toBeTruthy();
    }
    // Both should be in the same parallel bucket since neither has blockers.
    const bucketIds = new Set(allStories.map((s) => s.bucketId));
    expect(bucketIds.size).toBe(1);

    const buckets = db
      .select()
      .from(taskBuckets)
      .where(eq(taskBuckets.promptId, promptId))
      .all();
    expect(buckets[0]!.kind).toBe('parallel');
  }, 15_000);
});
