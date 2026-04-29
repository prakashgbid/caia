/**
 * Bucket routes (GATE-4-02).
 *
 * Surfaces the Phase-1 `task_buckets` table so the dashboard can render
 * a live bucket-placement kanban: sequential-per-domain queues + the
 * parallel pool, ticket counts per bucket, drilldown to bucket detail.
 *
 * The decider that writes these rows is `apps/orchestrator/src/agents/
 * bucket-placer.ts` (Gate 3 / PHASE1-03). This file is read-only and
 * does not mutate any data.
 *
 * Endpoints:
 *   GET /buckets                  — every bucket, with story counts and
 *                                    a small story preview, optionally
 *                                    filtered by `?promptId=`,
 *                                    `?domain=`, `?kind=`, `?status=`.
 *   GET /buckets/:id              — single bucket with all linked
 *                                    stories (id/title/status/template
 *                                    validation status) and a back-link
 *                                    to the prompt.
 */

import type { Hono } from 'hono';
import { eq, asc, desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { taskBuckets, stories, prompts } from '../../db/schema';

interface BucketRowOut {
  id: string;
  kind: string;
  domainSlug: string | null;
  // BUCKET-001/004 — multi-bucket placement key + level metadata.
  projectSlug: string | null;
  techSubDomain: string | null;
  levels: string[][];
  sequenceIndex: number | null;
  status: string;
  promptId: string;
  createdAt: number;
  ticketCount: number;
  validTicketCount: number;
  preview: Array<{
    id: string;
    title: string;
    status: string;
    templateValidationStatus: string;
    // BUCKET-001/003 — surface the per-story taxonomy on the card.
    projectSlug: string | null;
    techSubDomainPrimary: string | null;
    lifecycle: string | null;
    risk: string | null;
    priorityBucket: string | null;
  }>;
}

// @no-events — read-only routes
export function registerBucketsRoutes(app: Hono, db: Db): void {
  // GET /buckets — list buckets across all prompts.
  //
  // The dashboard uses this to render the kanban: each row in the result
  // is a bucket card (sequential per-domain or parallel pool) with its
  // ticket count and a 5-row preview. Filter by promptId, domain, kind
  // or status if needed.
  app.get('/buckets', (c) => {
    const { promptId, domain, kind, status, limit } = c.req.query();

    let rows = db.select().from(taskBuckets).orderBy(desc(taskBuckets.createdAt)).all();

    const project = c.req.query('project');
    const techSubDomain = c.req.query('techSubDomain');

    if (promptId) rows = rows.filter((r) => r.promptId === promptId);
    if (domain) rows = rows.filter((r) => r.domainSlug === domain);
    if (kind) rows = rows.filter((r) => r.kind === kind);
    if (status) rows = rows.filter((r) => r.status === status);
    // BUCKET-005 filters
    if (project) rows = rows.filter((r) => r.projectSlug === project);
    if (techSubDomain) rows = rows.filter((r) => r.techSubDomain === techSubDomain);

    const cap = limit ? Math.min(parseInt(limit, 10) || 200, 500) : 200;
    rows = rows.slice(0, cap);

    // Pull all stories for the visible buckets in one go.
    const bucketIds = new Set(rows.map((r) => r.id));
    const allStories = db
      .select({
        id: stories.id,
        title: stories.title,
        status: stories.status,
        bucketId: stories.bucketId,
        ordinal: stories.ordinal,
        templateValidationStatus: stories.templateValidationStatus,
        // BUCKET-001/003 fields surfaced on the bucket card.
        projectSlug: stories.projectSlug,
        techSubDomainPrimary: stories.techSubDomainPrimary,
        lifecycle: stories.lifecycle,
        risk: stories.risk,
        priorityBucket: stories.priorityBucket,
      })
      .from(stories)
      .all();

    const storiesByBucket = new Map<string, typeof allStories>();
    for (const s of allStories) {
      if (!s.bucketId) continue;
      if (!bucketIds.has(s.bucketId)) continue;
      const arr = storiesByBucket.get(s.bucketId) ?? [];
      arr.push(s);
      storiesByBucket.set(s.bucketId, arr);
    }

    const out: BucketRowOut[] = rows.map((b) => {
      const linked = (storiesByBucket.get(b.id) ?? []).slice().sort((a, z) => a.ordinal - z.ordinal);
      const valid = linked.filter((s) => s.templateValidationStatus === 'valid').length;
      let levels: string[][] = [];
      try {
        const parsed = JSON.parse(b.levelsJson ?? '[]');
        if (Array.isArray(parsed)) {
          levels = parsed.filter((lvl): lvl is string[] => Array.isArray(lvl));
        }
      } catch {
        /* malformed levelsJson treated as no levels */
      }
      return {
        id: b.id,
        kind: b.kind,
        domainSlug: b.domainSlug,
        projectSlug: b.projectSlug,
        techSubDomain: b.techSubDomain,
        levels,
        sequenceIndex: b.sequenceIndex,
        status: b.status,
        promptId: b.promptId,
        createdAt: b.createdAt,
        ticketCount: linked.length,
        validTicketCount: valid,
        preview: linked.slice(0, 5).map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          templateValidationStatus: s.templateValidationStatus,
          projectSlug: s.projectSlug,
          techSubDomainPrimary: s.techSubDomainPrimary,
          lifecycle: s.lifecycle,
          risk: s.risk,
          priorityBucket: s.priorityBucket,
        })),
      };
    });

    // Group for the kanban payload too — saves the dashboard a pass.
    const grouped = {
      sequential: out.filter((b) => b.kind === 'sequential'),
      parallel: out.filter((b) => b.kind === 'parallel'),
    };

    return c.json({ total: out.length, buckets: out, grouped });
  });

  // GET /buckets/:id — full bucket detail.
  //
  // Returns the bucket row + the full ordered story list + a small
  // prompt header so the dashboard can render the bucket detail card
  // with a "back to prompt" affordance.
  app.get('/buckets/:id', (c) => {
    const id = c.req.param('id');
    const bucket = db.select().from(taskBuckets).where(eq(taskBuckets.id, id)).get();
    if (!bucket) return c.json({ error: 'not found' }, 404);

    const linked = db
      .select()
      .from(stories)
      .where(eq(stories.bucketId, id))
      .orderBy(asc(stories.ordinal))
      .all();

    const promptRow = db
      .select({
        id: prompts.id,
        body: prompts.body,
        status: prompts.status,
        receivedAt: prompts.receivedAt,
      })
      .from(prompts)
      .where(eq(prompts.id, bucket.promptId))
      .get();

    return c.json({
      bucket: {
        id: bucket.id,
        kind: bucket.kind,
        domainSlug: bucket.domainSlug,
        sequenceIndex: bucket.sequenceIndex,
        status: bucket.status,
        promptId: bucket.promptId,
        createdAt: bucket.createdAt,
        metadata: bucket.metadata,
      },
      prompt: promptRow ?? null,
      stories: linked.map((s) => ({
        id: s.id,
        title: s.title,
        kind: s.kind,
        status: s.status,
        ordinal: s.ordinal,
        templateVersion: s.templateVersion,
        templateValidationStatus: s.templateValidationStatus,
        domainSlugsJson: s.domainSlugsJson,
      })),
    });
  });
}
