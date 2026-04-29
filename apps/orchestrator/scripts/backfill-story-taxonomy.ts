/**
 * BUCKET-007 — backfill the BUCKET-001 9-axis taxonomy fields on every
 * existing story that's missing them.
 *
 * Strategy:
 *   1. Pull every story with `project_slug IS NULL OR
 *      tech_sub_domain_primary IS NULL OR lifecycle IS NULL`.
 *   2. For each, run the deterministic PO classifiers on the title+
 *      description to fill project / business sub-domains / lifecycle /
 *      priority, and the EA pure helpers to fill tech sub-domains /
 *      quality tags / risk / effort / blocked-by markers / claims.
 *   3. UPDATE the row in a single transaction. Idempotent: re-running
 *      this script never overwrites already-populated fields.
 *   4. Emit a `story.taxonomy.backfilled` event per story for traceability.
 *
 * Usage:
 *   pnpm --filter @caia-app/core exec tsx scripts/backfill-story-taxonomy.ts
 *
 * Or programmatically: `import { runBackfillStoryTaxonomy } from
 * './scripts/backfill-story-taxonomy';` and call `runBackfillStoryTaxonomy(db)`.
 */

import { isNull, or, eq } from 'drizzle-orm';
import {
  classifyKeyword,
  classifyProject,
  classifyBusinessSubDomains,
  classifyLifecycle,
  classifyPriority,
} from '@chiefaia/classifier';
import {
  inferTechSubDomains,
  inferQualityTags,
  inferRisk,
  inferEffort,
  inferBlockedBy,
  inferClaims,
} from '../src/agents/ea-agent';
import { eventBus } from '../src/events/bus-adapter';
import type { Db } from '../src/db/connection';
import { stories } from '../src/db/schema';

export interface BackfillResult {
  scanned: number;
  populated: number;
  skipped: number;
}

/**
 * Backfill missing taxonomy fields on all stories. Idempotent: a field is
 * only updated if it was NULL or its JSON column held an empty default.
 */
export function runBackfillStoryTaxonomy(db: Db): BackfillResult {
  // Pull candidates. We'd rather scan-and-filter than try to OR three
  // nullable column checks in Drizzle — the candidate set is bounded.
  const candidates = db
    .select()
    .from(stories)
    .where(
      or(
        isNull(stories.projectSlug),
        isNull(stories.techSubDomainPrimary),
        isNull(stories.lifecycle),
      ),
    )
    .all();

  let populated = 0;
  let skipped = 0;

  for (const story of candidates) {
    const text = `${story.title} ${story.description ?? ''}`;
    const updates: Partial<typeof stories.$inferInsert> = {};

    // PO-level classifiers.
    if (!story.projectSlug) {
      const r = classifyProject(text);
      updates.projectSlug = r.slug;
    }
    if (!story.lifecycle) {
      updates.lifecycle = classifyLifecycle(text);
    }
    if (!story.priorityBucket) {
      updates.priorityBucket = classifyPriority(text);
    }
    if (!story.businessSubDomainsJson || story.businessSubDomainsJson === '[]') {
      const project = updates.projectSlug ?? story.projectSlug ?? 'unassigned';
      const subDomains = classifyBusinessSubDomains(text, project);
      updates.businessSubDomainsJson = JSON.stringify(subDomains);
    }

    // EA-level inferences.
    const classifierOut = classifyKeyword(text);

    if (!story.techSubDomainPrimary) {
      const tech = inferTechSubDomains(text, classifierOut.primaryDomain);
      updates.techSubDomainPrimary = tech.primary;
      updates.techSubDomainsJson = JSON.stringify(tech.all);
    } else if (!story.techSubDomainsJson || story.techSubDomainsJson === '[]') {
      const tech = inferTechSubDomains(text, classifierOut.primaryDomain);
      updates.techSubDomainsJson = JSON.stringify(tech.all);
    }

    if (!story.qualityTagsJson || story.qualityTagsJson === '[]') {
      updates.qualityTagsJson = JSON.stringify(inferQualityTags(text));
    }

    const techAll = updates.techSubDomainsJson
      ? (JSON.parse(updates.techSubDomainsJson as string) as string[])
      : ((JSON.parse(story.techSubDomainsJson ?? '[]') as string[]) || []);
    const qualityTags = updates.qualityTagsJson
      ? (JSON.parse(updates.qualityTagsJson as string) as string[])
      : ((JSON.parse(story.qualityTagsJson ?? '[]') as string[]) || []);

    if (!story.risk) {
      updates.risk = inferRisk(
        techAll,
        qualityTags,
        (updates.lifecycle ?? story.lifecycle) ?? null,
      );
    }
    if (!story.effort) {
      updates.effort = inferEffort(text, classifierOut.complexity);
    }

    if (!story.blockedByJson || story.blockedByJson === '[]') {
      const found = inferBlockedBy(text);
      if (found.length > 0) {
        updates.blockedByJson = JSON.stringify(found);
      }
    }

    if (!story.claimsJson || story.claimsJson === '{}') {
      const claims = inferClaims(text, techAll);
      updates.claimsJson = JSON.stringify(claims);
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    db.update(stories).set(updates).where(eq(stories.id, story.id)).run();
    populated++;

    eventBus.publish({
      type: 'story.taxonomy.backfilled',
      actor: 'system',
      correlation_id: 'backfill',
      entity_type: 'story',
      entity_id: story.id,
      payload: {
        storyId: story.id,
        fieldsPopulated: Object.keys(updates),
      },
    });
  }

  return {
    scanned: candidates.length,
    populated,
    skipped,
  };
}
