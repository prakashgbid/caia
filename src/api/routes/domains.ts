import type { Hono } from 'hono';
import { eq, and, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { getSqliteRaw } from '../../db/connection';
import {
  domains,
  entityDomains,
  requirements,
  blockers,
  questions,
  adrs,
  businessFeatures,
  proactiveSuggestions,
  timelineEvents,
} from '../../db/schema';
import { bus } from '../../ws/bus';

const VALID_ENTITY_TYPES = new Set([
  'requirement', 'blocker', 'question', 'adr', 'feature', 'suggestion', 'timeline',
]);

// Returns entity count per (domain_slug, entity_type) from raw SQLite for efficiency
function getDomainCounts(sqlite: ReturnType<typeof getSqliteRaw>): Map<string, Record<string, number>> {
  const rows = sqlite.prepare(
    'SELECT domain_slug, entity_type, COUNT(*) as cnt FROM entity_domains GROUP BY domain_slug, entity_type'
  ).all() as Array<{ domain_slug: string; entity_type: string; cnt: number }>;

  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    if (!map.has(row.domain_slug)) map.set(row.domain_slug, {});
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    map.get(row.domain_slug)![row.entity_type] = row.cnt;
  }
  return map;
}

export function registerDomainRoutes(app: Hono, db: Db): void {
  // GET /domains — list all with entity counts per type
  app.get('/domains', (c) => {
    const allDomains = db.select().from(domains).all();
    let counts: Map<string, Record<string, number>>;
    try {
      counts = getDomainCounts(getSqliteRaw());
    } catch {
      counts = new Map();
    }

    const result = allDomains.map(d => ({
      ...d,
      counts: counts.get(d.slug) ?? {},
      totalEntities: Object.values(counts.get(d.slug) ?? {}).reduce((a, b) => a + b, 0),
    }));
    return c.json(result);
  });

  // GET /domains/:slug — one domain + all entities paginated by type
  app.get('/domains/:slug', (c) => {
    const { slug } = c.req.param();
    const { project, limit: lim } = c.req.query() as Record<string, string>;
    const limitN = Math.min(parseInt(lim ?? '50', 10), 200);

    const domain = db.select().from(domains).where(eq(domains.slug, slug)).all()[0];
    if (!domain) return c.json({ error: 'Domain not found' }, 404);

    // Get all entity_domains rows for this domain
    const edRows = db.select().from(entityDomains).where(eq(entityDomains.domainSlug, slug)).all();

    const entityIdsByType = new Map<string, Set<string>>();
    for (const row of edRows) {
      if (!entityIdsByType.has(row.entityType)) entityIdsByType.set(row.entityType, new Set());
      entityIdsByType.get(row.entityType)!.add(row.entityId);
    }

    function fetchEntities<T extends { id: string; projectId?: string | null }>(
      type: string,
      all: T[],
    ): T[] {
      const ids = entityIdsByType.get(type);
      if (!ids?.size) return [];
      let rows = all.filter(r => ids.has(r.id));
      if (project) rows = rows.filter(r => r.projectId === project);
      return rows.slice(0, limitN);
    }

    const allReqs = db.select().from(requirements).all();
    const allBlockers = db.select().from(blockers).all();
    const allQuestions = db.select().from(questions).all();
    const allAdrs = db.select().from(adrs).all();
    const allFeatures = db.select().from(businessFeatures).all();
    const allSuggestions = db.select().from(proactiveSuggestions).all();
    const allTimeline = db.select().from(timelineEvents).all();

    // Project breakdown: count entities per project across all types
    const projectBreakdown: Record<string, number> = {};
    for (const row of edRows) {
      const projectId = (
        allReqs.find(r => r.id === row.entityId)?.projectId ??
        allBlockers.find(r => r.id === row.entityId)?.projectId ??
        allQuestions.find(r => r.id === row.entityId)?.projectId ??
        allAdrs.find(r => r.id === row.entityId)?.projectId ??
        allFeatures.find(r => r.id === row.entityId)?.projectId ??
        allSuggestions.find(r => r.id === row.entityId)?.projectId ??
        allTimeline.find(r => r.id === row.entityId)?.projectId
      ) ?? 'global';
      projectBreakdown[projectId] = (projectBreakdown[projectId] ?? 0) + 1;
    }

    return c.json({
      domain,
      counts: {
        requirement: entityIdsByType.get('requirement')?.size ?? 0,
        blocker: entityIdsByType.get('blocker')?.size ?? 0,
        question: entityIdsByType.get('question')?.size ?? 0,
        adr: entityIdsByType.get('adr')?.size ?? 0,
        feature: entityIdsByType.get('feature')?.size ?? 0,
        suggestion: entityIdsByType.get('suggestion')?.size ?? 0,
        timeline: entityIdsByType.get('timeline')?.size ?? 0,
      },
      projectBreakdown,
      entities: {
        requirements: fetchEntities('requirement', allReqs),
        blockers: fetchEntities('blocker', allBlockers),
        questions: fetchEntities('question', allQuestions),
        adrs: fetchEntities('adr', allAdrs),
        features: fetchEntities('feature', allFeatures),
        suggestions: fetchEntities('suggestion', allSuggestions),
        timeline: fetchEntities('timeline', allTimeline),
      },
    });
  });

  // POST /domains — create
  app.post('/domains', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const slug = body['slug'] as string ?? nanoid(8);
    const row = {
      slug,
      name: body['name'] as string,
      description: (body['description'] as string) ?? '',
      color: (body['color'] as string) ?? '#718096',
      icon: (body['icon'] as string) ?? '📂',
      parentSlug: body['parentSlug'] as string | undefined,
      createdAt: now,
    };
    try {
      db.insert(domains).values(row).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) return c.json({ error: `Slug "${slug}" already exists` }, 409);
      return c.json({ error: msg }, 500);
    }
    bus.push({ kind: 'domain.created', id: slug, payload: row, ts: now });
    return c.json(row, 201);
  });

  // PUT /domains/:slug — update
  app.put('/domains/:slug', async (c) => {
    const { slug } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>();
    const allowed = ['name', 'description', 'color', 'icon', 'parentSlug'];
    const update: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    if (Object.keys(update).length === 0) return c.json({ error: 'No updatable fields provided' }, 400);
    db.update(domains).set(update as Parameters<ReturnType<typeof db.update>['set']>[0]).where(eq(domains.slug, slug)).run();
    const row = db.select().from(domains).where(eq(domains.slug, slug)).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    bus.push({ kind: 'domain.updated', id: slug, payload: row, ts: new Date().toISOString() });
    return c.json(row);
  });

  // DELETE /domains/:slug — soft-delete only if no entities; otherwise 409
  app.delete('/domains/:slug', (c) => {
    const { slug } = c.req.param();
    const entityCount = db.select().from(entityDomains).where(eq(entityDomains.domainSlug, slug)).all().length;
    if (entityCount > 0) {
      return c.json({ error: `Cannot delete domain with ${entityCount} attached entities. Detach entities first.` }, 409);
    }
    db.delete(domains).where(eq(domains.slug, slug)).run();
    bus.push({ kind: 'domain.deleted', id: slug, payload: { slug }, ts: new Date().toISOString() });
    return c.json({ deleted: slug });
  });

  // POST /entities/:type/:id/domains — attach domain(s) to an entity
  app.post('/entities/:type/:id/domains', async (c) => {
    const { type, id } = c.req.param();
    if (!VALID_ENTITY_TYPES.has(type)) return c.json({ error: `Invalid entity type: ${type}` }, 400);
    const body = await c.req.json<{ domains: string[] } | { domain: string }>();
    const slugs: string[] = 'domains' in body ? body.domains : [body.domain];
    const now = new Date().toISOString();
    const added: string[] = [];
    for (const domainSlug of slugs) {
      const exists = db.select().from(domains).where(eq(domains.slug, domainSlug)).all()[0];
      if (!exists) continue;
      try {
        db.insert(entityDomains).values({ entityType: type, entityId: id, domainSlug, autoTagged: false, createdAt: now }).run();
        added.push(domainSlug);
      } catch {
        // already tagged — ignore
      }
    }
    bus.push({ kind: 'entity.tagged', id, payload: { entityType: type, entityId: id, domains: added }, ts: now });
    return c.json({ entityType: type, entityId: id, added });
  });

  // DELETE /entities/:type/:id/domains/:slug — detach
  app.delete('/entities/:type/:id/domains/:domainSlug', (c) => {
    const { type, id, domainSlug } = c.req.param();
    if (!VALID_ENTITY_TYPES.has(type)) return c.json({ error: `Invalid entity type: ${type}` }, 400);
    db.delete(entityDomains).where(
      and(
        eq(entityDomains.entityType, type),
        eq(entityDomains.entityId, id),
        eq(entityDomains.domainSlug, domainSlug),
      )
    ).run();
    bus.push({ kind: 'entity.untagged', id, payload: { entityType: type, entityId: id, domainSlug }, ts: new Date().toISOString() });
    return c.json({ entityType: type, entityId: id, removed: domainSlug });
  });

  // GET /entities/:type/:id/domains — list domains for an entity
  app.get('/entities/:type/:id/domains', (c) => {
    const { type, id } = c.req.param();
    if (!VALID_ENTITY_TYPES.has(type)) return c.json({ error: `Invalid entity type: ${type}` }, 400);
    const rows = db.select().from(entityDomains).where(
      and(eq(entityDomains.entityType, type), eq(entityDomains.entityId, id))
    ).all();
    const slugs = rows.map(r => r.domainSlug);
    if (slugs.length === 0) return c.json([]);
    const domainRows = db.select().from(domains).where(inArray(domains.slug, slugs)).all();
    return c.json(domainRows);
  });
}

// Helper exported for use in other routes — returns Set of entity IDs for a domain+type
export function getEntityIdsForDomains(db: Db, type: string, domainSlugs: string[]): Set<string> {
  if (!domainSlugs.length) return new Set();
  const rows = db.select({ entityId: entityDomains.entityId })
    .from(entityDomains)
    .where(
      and(
        eq(entityDomains.entityType, type),
        inArray(entityDomains.domainSlug, domainSlugs),
      )
    )
    .all();
  return new Set(rows.map(r => r.entityId));
}
