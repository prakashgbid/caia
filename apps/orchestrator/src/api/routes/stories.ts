import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import type { Db } from '../../db/connection';
import { getSqliteRaw } from '../../db/connection';
import {
  stories, storyRevisions,
  completenessRuns, completenessFindings, completenessSchedule,
  lockContracts, lockContractRevisions, memoryAnchors, dbBackups,
  // timelineEvents and auditLog imported via schema but used via raw SQL

} from '../../db/schema';
import { bus } from '../../ws/bus';
import { eventBus } from '../../events/bus-adapter';
import { getTicketBundle } from '../ticket-bundle';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// @no-events — route registration wrapper, individual handlers emit events
export function registerStoriesRoutes(app: Hono, db: Db): void {
  // GET /stories
  // DASH-001: status filter was being silently ignored. Story rows have a
  // `status` column ('pending'|'resolved'|...); GET /stories?status=pending
  // historically returned all 383 rows because the handler never read the
  // `status` query param. Audit `outstanding-tasks-audit-2026-04-30.md`.
  app.get('/stories', (c) => {
    const { parent_id, project_slug, kind, root, status } = c.req.query();
    let rows = db.select().from(stories).orderBy(stories.ordinal).all();
    if (root === 'true') rows = rows.filter(r => r.parentId === null);
    if (parent_id) rows = rows.filter(r => r.parentId === parent_id);
    if (project_slug) rows = rows.filter(r => r.projectSlug === project_slug);
    if (kind) rows = rows.filter(r => r.kind === kind);
    if (status) {
      // Comma-separated allowed: ?status=pending,resolved
      const wanted = new Set(status.split(',').map(s => s.trim()).filter(Boolean));
      rows = rows.filter(r => wanted.has(r.status));
    }
    return c.json(rows);
  });

  // GET /stories/:id
  app.get('/stories/:id', (c) => {
    const id = c.req.param('id');
    const node = db.select().from(stories).where(eq(stories.id, id)).get();
    if (!node) return c.json({ error: 'not found' }, 404);
    const children = db.select().from(stories).where(eq(stories.parentId, id)).orderBy(stories.ordinal).all();
    return c.json({ ...node, children });
  });

  // GET /stories/:id/tree
  app.get('/stories/:id/tree', (c) => {
    const rootId = c.req.param('id');
    const all = db.select().from(stories).all();
    function buildTree(nodeId: string): Record<string, unknown> | null {
      const node = all.find(n => n.id === nodeId);
      if (!node) return null;
      const children = all.filter(n => n.parentId === nodeId).sort((a, b) => a.ordinal - b.ordinal);
      return { ...node, children: children.map(ch => buildTree(ch.id)).filter(Boolean) };
    }
    const tree = buildTree(rootId);
    if (!tree) return c.json({ error: 'not found' }, 404);
    return c.json(tree);
  });

  // GET /stories/:id/revisions
  app.get('/stories/:id/revisions', (c) => {
    const id = c.req.param('id');
    const revs = db.select().from(storyRevisions)
      .where(eq(storyRevisions.storyId, id))
      .orderBy(desc(storyRevisions.version))
      .all();
    return c.json(revs);
  });

  // GET /stories/:id/bundle — Phase-1 self-contained ticket bundle: story
  // row + parsed TicketTemplateV1 (validated) + linked requirement + bucket
  // + entity_labels + dependency / dependent id lists. Read-only, used by
  // the executor and the phase1-e2e acceptance test.
  app.get('/stories/:id/bundle', (c) => {
    const id = c.req.param('id');
    const bundle = getTicketBundle(db, id);
    if (!bundle) return c.json({ error: 'not found' }, 404);
    return c.json(bundle);
  });

  // POST /stories — transactional: story + revision_v1 + timeline
  app.post('/stories', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const nodeId = (body['id'] as string | null) ?? ('st_' + nanoid(10));
    const node = {
      id: nodeId,
      parentId: (body['parent_id'] as string | null) ?? null,
      prevSiblingId: (body['prev_sibling_id'] as string | null) ?? null,
      nextSiblingId: (body['next_sibling_id'] as string | null) ?? null,
      ordinal: (body['ordinal'] as number | null) ?? 0,
      kind: (body['kind'] as string | null) ?? 'task',
      title: body['title'] as string,
      description: (body['description'] as string | null) ?? '',
      expectedBehavior: (body['expected_behavior'] as string | null) ?? '',
      acceptanceCriteriaJson: JSON.stringify(body['acceptance_criteria'] ?? []),
      verificationPlanJson: JSON.stringify(body['verification_plan'] ?? []),
      behaviorTestPath: (body['behavior_test_path'] as string | null) ?? null,
      behaviorTestSkeleton: (body['behavior_test_skeleton'] as string | null) ?? null,
      dependsOnJson: JSON.stringify(body['depends_on'] ?? []),
      projectSlug: (body['project_slug'] as string | null) ?? null,
      domainSlugsJson: JSON.stringify(body['domain_slugs'] ?? []),
      status: 'pending' as const,
      createdAt: now,
      lastDecomposedAt: null,
    };

    // Transactional: story + first revision + timeline
    const sqlite = getSqliteRaw();
    const tx = sqlite.transaction(() => {
      sqlite.prepare(`
        INSERT INTO stories (id, parent_id, prev_sibling_id, next_sibling_id, ordinal, kind, title,
          description, expected_behavior, acceptance_criteria_json, verification_plan_json,
          behavior_test_path, behavior_test_skeleton, depends_on_json, project_slug,
          domain_slugs_json, status, created_at, last_decomposed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node.id, node.parentId, node.prevSiblingId, node.nextSiblingId, node.ordinal,
        node.kind, node.title, node.description, node.expectedBehavior,
        node.acceptanceCriteriaJson, node.verificationPlanJson,
        node.behaviorTestPath, node.behaviorTestSkeleton,
        node.dependsOnJson, node.projectSlug, node.domainSlugsJson,
        node.status, node.createdAt, node.lastDecomposedAt
      );
      sqlite.prepare(`
        INSERT INTO story_revisions (story_id, version, snapshot_json, changed_at, changed_by)
        VALUES (?, 1, ?, ?, 'system')
      `).run(node.id, JSON.stringify(node), now);
      sqlite.prepare(`
        INSERT INTO timeline_events (id, kind, actor, summary, subject_id, subject_kind, payload, created_at)
        VALUES (?, 'story.created', 'system', ?, ?, 'story', ?, ?)
      `).run('tl_' + nanoid(8), `Story created: ${node.title}`, node.id, JSON.stringify({ kind: node.kind }), now);
    });
    tx();

    bus.push({ kind: 'story.created', id: node.id, projectId: node.projectSlug ?? undefined, payload: { node }, ts: now });
    eventBus.publish({ type: 'story.created', actor: 'api', entity_type: 'story', entity_id: node.id, project_slug: node.projectSlug ?? undefined, payload: { story_id: node.id, title: node.title, kind: node.kind, project_slug: node.projectSlug } });
    return c.json(node, 201);
  });

  // PATCH /stories/:id — transactional: update + new revision + timeline
  app.patch('/stories/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();

    const existing = db.select().from(stories).where(eq(stories.id, id)).get();
    if (!existing) return c.json({ error: 'not found' }, 404);

    const updates: Record<string, unknown> = {};
    if (body['title'] !== undefined) updates['title'] = body['title'];
    if (body['description'] !== undefined) updates['description'] = body['description'];
    if (body['expected_behavior'] !== undefined) updates['expectedBehavior'] = body['expected_behavior'];
    if (body['acceptance_criteria'] !== undefined) updates['acceptanceCriteriaJson'] = JSON.stringify(body['acceptance_criteria']);
    if (body['verification_plan'] !== undefined) updates['verificationPlanJson'] = JSON.stringify(body['verification_plan']);
    if (body['behavior_test_path'] !== undefined) updates['behaviorTestPath'] = body['behavior_test_path'];
    if (body['behavior_test_skeleton'] !== undefined) updates['behaviorTestSkeleton'] = body['behavior_test_skeleton'];
    if (body['status'] !== undefined) updates['status'] = body['status'];
    if (body['last_decomposed_at'] !== undefined) updates['lastDecomposedAt'] = body['last_decomposed_at'];

    const sqlite = getSqliteRaw();
    const maxRevRow = sqlite.prepare('SELECT MAX(version) as v FROM story_revisions WHERE story_id = ?').get(id) as { v: number | null };
    const nextVersion = (maxRevRow?.v ?? 0) + 1;

    const tx = sqlite.transaction(() => {
      db.update(stories).set(updates).where(eq(stories.id, id)).run();
      const updated = { ...existing, ...updates };
      sqlite.prepare(`
        INSERT INTO story_revisions (story_id, version, snapshot_json, changed_at, changed_by)
        VALUES (?, ?, ?, ?, 'system')
      `).run(id, nextVersion, JSON.stringify(updated), now);
      sqlite.prepare(`
        INSERT INTO timeline_events (id, kind, actor, summary, subject_id, subject_kind, payload, created_at)
        VALUES (?, 'story.updated', 'system', ?, ?, 'story', ?, ?)
      `).run('tl_' + nanoid(8), `Story updated: ${existing.title}`, id, JSON.stringify({ version: nextVersion }), now);
    });
    tx();

    bus.push({ kind: 'story.updated', id, payload: updates, ts: now });
    eventBus.publish({ type: 'story.updated', actor: 'api', entity_type: 'story', entity_id: id, payload: { story_id: id, fields_changed: Object.keys(updates) } });
    return c.json({ ok: true });
  });
}

// @no-events — route registration wrapper, individual handlers emit events
export function registerCompletenessRoutes(app: Hono, db: Db): void {
  // GET /completeness/runs
  app.get('/completeness/runs', (c) => {
    const { entity_kind, entity_id, limit: lim } = c.req.query();
    const limitN = Math.min(parseInt(lim ?? '100', 10), 500);
    let rows = db.select().from(completenessRuns).orderBy(desc(completenessRuns.runAt)).limit(limitN).all();
    if (entity_kind) rows = rows.filter(r => r.entityKind === entity_kind);
    if (entity_id) rows = rows.filter(r => r.entityId === entity_id);
    return c.json(rows);
  });

  // POST /completeness/runs — transactional: run row + findings rows + re-exec requirement on fail + timeline
  app.post('/completeness/runs', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const findings = (body['findings'] as Array<Record<string, unknown>> | undefined) ?? [];
    const status = (body['status'] as string) ?? 'pending';

    // DASH-305: emit run_started before the transaction so dashboard
    // subscribers can pre-mark the entity as in-flight. Fires once per run
    // regardless of outcome; pairs with the run_completed/check.completed
    // events emitted after the transaction commits.
    eventBus.publish({
      type: 'completeness.run_started',
      actor: 'completeness-sentinel',
      entity_type: (body['entity_kind'] as string) ?? 'unknown',
      entity_id: (body['entity_id'] as string) ?? 'unknown',
      payload: {
        entity_kind: (body['entity_kind'] as string) ?? 'unknown',
        entity_id: (body['entity_id'] as string) ?? 'unknown',
        checks_total: (body['checks_total'] as number) ?? 0,
        started_at: now,
      },
    });

    const sqlite = getSqliteRaw();
    let runId = 0;

    const tx = sqlite.transaction(() => {
      const res = sqlite.prepare(`
        INSERT INTO completeness_runs (run_at, entity_kind, entity_id, checks_total, checks_passed,
          score_pct, status, findings_json, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        now,
        body['entity_kind'] as string,
        body['entity_id'] as string,
        (body['checks_total'] as number) ?? 0,
        (body['checks_passed'] as number) ?? 0,
        (body['score_pct'] as number) ?? 0,
        status,
        JSON.stringify(findings),
        (body['duration_ms'] as number | null) ?? null
      );
      runId = Number(res.lastInsertRowid);

      // Insert individual finding rows
      for (const f of findings) {
        sqlite.prepare(`
          INSERT INTO completeness_findings (run_id, entity_kind, entity_id, check_kind, expected, actual, severity, message, evidence_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          runId,
          body['entity_kind'] as string,
          body['entity_id'] as string,
          f['check_kind'] as string ?? 'manual',
          f['expected'] as string ?? '',
          f['actual'] as string ?? '',
          f['severity'] as string ?? 'warning',
          f['message'] as string ?? '',
          (f['evidence_url'] as string | null) ?? null
        );
      }

      // If failed: create a re-execution requirement atomically
      if (status === 'fail') {
        const reqId = 'req_' + nanoid(10);
        const failedChecks = findings.filter((f) => f['severity'] !== 'info');
        sqlite.prepare(`
          INSERT INTO requirements (id, title, description, state, priority, labels, target_project,
            estimated_files, depends_on, linked_task_ids, spec, project_id, scope, created_at, updated_at)
          VALUES (?, ?, ?, 'captured', 1, '["auto-reverification"]', NULL, '[]', '[]', '[]', NULL, NULL, 'global', ?, ?)
        `).run(
          reqId,
          `[auto-reverify] ${body['entity_kind'] as string}/${(body['entity_id'] as string).slice(0, 12)}`,
          `Completeness sentinel found ${failedChecks.length} failing checks. Re-execute and verify.\n\n` +
            failedChecks.map((f) => `- ${f['message'] as string ?? ''}`).join('\n'),
          now, now
        );
      }

      // Timeline event
      sqlite.prepare(`
        INSERT INTO timeline_events (id, kind, actor, summary, subject_id, subject_kind, payload, created_at)
        VALUES (?, ?, 'system', ?, ?, 'completeness_run', ?, ?)
      `).run(
        'tl_' + nanoid(8),
        status === 'fail' ? 'completeness_failure' : 'completeness_pass',
        `Completeness ${status}: ${body['entity_kind'] as string}/${body['entity_id'] as string} — ${body['score_pct'] as number ?? 0}%`,
        String(runId),
        JSON.stringify({ score_pct: body['score_pct'], findings_count: findings.length }),
        now
      );
    });
    tx();

    bus.push({ kind: 'completeness.run', id: String(runId), payload: { status, score_pct: body['score_pct'] }, ts: now });
    eventBus.publish({ type: 'completeness.run_completed', actor: 'completeness-sentinel', payload: { run_id: runId, score_pct: (body['score_pct'] as number) ?? 0, checks_passed: 0, checks_total: 0 } });

    // Structured completeness observability events
    const criticalCount = findings.filter((f) => f['severity'] === 'critical').length;
    eventBus.publish({
      type: 'completeness.check.completed',
      actor: 'completeness-sentinel',
      payload: {
        runId,
        entityKind: body['entity_kind'] as string,
        entityId: body['entity_id'] as string,
        passed: status !== 'fail',
        findingCount: findings.length,
        criticalCount,
        score: (body['score_pct'] as number) ?? 0,
        checksTotal: (body['checks_total'] as number) ?? 0,
        checksPassed: (body['checks_passed'] as number) ?? 0,
      },
    });
    eventBus.publish({
      type: 'pipeline.stage.advanced',
      actor: 'completeness-sentinel',
      payload: {
        stage: 'verified',
        entityKind: body['entity_kind'] as string,
        entityId: body['entity_id'] as string,
        passed: status !== 'fail',
        score: (body['score_pct'] as number) ?? 0,
      },
    });

    // DASH-305: emit one finding_filed event per finding so the dashboard's
    // /completeness page (and the prioritizer, which already subscribes)
    // can react in near-real-time without polling. Severity is preserved
    // so the consumer can filter (e.g. only critical findings light up
    // the badge).
    for (const f of findings) {
      eventBus.publish({
        type: 'completeness.finding_filed',
        actor: 'completeness-sentinel',
        entity_type: (body['entity_kind'] as string) ?? 'unknown',
        entity_id: (body['entity_id'] as string) ?? 'unknown',
        severity: ((f['severity'] as string) === 'critical' ? 'error'
          : (f['severity'] as string) === 'warning' ? 'warning' : 'info'),
        payload: {
          run_id: runId,
          entity_kind: (body['entity_kind'] as string) ?? 'unknown',
          entity_id: (body['entity_id'] as string) ?? 'unknown',
          check_kind: (f['check_kind'] as string) ?? 'manual',
          severity: (f['severity'] as string) ?? 'warning',
          message: (f['message'] as string) ?? '',
        },
      });
    }

    return c.json({ id: runId, status, runAt: now }, 201);
  });

  // GET /completeness/findings
  app.get('/completeness/findings', (c) => {
    const { run_id, entity_kind, entity_id, severity } = c.req.query();
    let rows = db.select().from(completenessFindings).orderBy(desc(completenessFindings.id)).limit(500).all();
    if (run_id) rows = rows.filter(r => r.runId === parseInt(run_id, 10));
    if (entity_kind) rows = rows.filter(r => r.entityKind === entity_kind);
    if (entity_id) rows = rows.filter(r => r.entityId === entity_id);
    if (severity) rows = rows.filter(r => r.severity === severity);
    return c.json(rows);
  });

  // GET /completeness/summary
  app.get('/completeness/summary', (c) => {
    const runs = db.select().from(completenessRuns).orderBy(desc(completenessRuns.runAt)).limit(1000).all();
    const latest = new Map<string, typeof runs[0]>();
    for (const r of runs) {
      const key = `${r.entityKind}:${r.entityId}`;
      if (!latest.has(key)) latest.set(key, r);
    }
    const entities = Array.from(latest.values());
    return c.json({
      entities,
      total: entities.length,
      passing: entities.filter(r => r.status === 'pass').length,
      failing: entities.filter(r => r.status === 'fail').length,
    });
  });

  // GET /completeness/schedule
  app.get('/completeness/schedule', (c) => {
    const row = db.select().from(completenessSchedule).limit(1).get();
    return c.json(row ?? { scheduleCron: '0 */2 * * *', enabled: true, lastRunAt: null, nextRunAt: null });
  });

  // PATCH /completeness/schedule
  app.patch('/completeness/schedule', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const existing = db.select().from(completenessSchedule).limit(1).get();
    if (!existing) db.insert(completenessSchedule).values({ scheduleCron: '0 */2 * * *', enabled: true }).run();
    const updates: Record<string, unknown> = {};
    if (body['enabled'] !== undefined) updates['enabled'] = body['enabled'];
    if (body['last_run_at'] !== undefined) updates['lastRunAt'] = body['last_run_at'];
    if (body['next_run_at'] !== undefined) updates['nextRunAt'] = body['next_run_at'];
    db.update(completenessSchedule).set(updates).run();
    return c.json({ ok: true });
  });
}

// @no-events — route registration wrapper, individual handlers emit events
export function registerLockContractRoutes(app: Hono, db: Db): void {
  // GET /lock-contracts
  app.get('/lock-contracts', (c) => {
    const { kind, active } = c.req.query();
    let rows = db.select().from(lockContracts).orderBy(lockContracts.slug).all();
    if (kind) rows = rows.filter(r => r.kind === kind);
    if (active === 'true') rows = rows.filter(r => r.active);
    return c.json(rows);
  });

  // GET /lock-contracts/:slug
  app.get('/lock-contracts/:slug', (c) => {
    const slug = c.req.param('slug');
    const row = db.select().from(lockContracts).where(eq(lockContracts.slug, slug)).get();
    if (!row) return c.json({ error: 'not found' }, 404);
    const revisions = db.select().from(lockContractRevisions)
      .where(eq(lockContractRevisions.contractId, row.id))
      .orderBy(desc(lockContractRevisions.version))
      .all();
    return c.json({ ...row, revisions });
  });

  // POST /lock-contracts
  app.post('/lock-contracts', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const bodyMd = (body['body_md'] as string) ?? '';
    const id = 'lc_' + nanoid(10);
    const row = {
      id,
      slug: body['slug'] as string,
      kind: (body['kind'] as string) ?? 'standard',
      title: body['title'] as string,
      bodyMd,
      version: 1,
      active: true,
      createdAt: now,
      updatedAt: now,
      checksum: sha256(bodyMd),
    };
    const sqlite = getSqliteRaw();
    const tx = sqlite.transaction(() => {
      db.insert(lockContracts).values(row).run();
      sqlite.prepare(`
        INSERT INTO lock_contract_revisions (contract_id, version, body_md, changed_at, changed_by)
        VALUES (?, 1, ?, ?, 'system')
      `).run(id, bodyMd, now);
      sqlite.prepare(`
        INSERT INTO timeline_events (id, kind, actor, summary, subject_id, subject_kind, payload, created_at)
        VALUES (?, 'lock_contract.created', 'system', ?, ?, 'lock_contract', '{}', ?)
      `).run('tl_' + nanoid(8), `Lock contract created: ${row.slug}`, id, now);
    });
    tx();
    bus.push({ kind: 'lock_contract.created', id, payload: { slug: row.slug }, ts: now });
    return c.json(row, 201);
  });

  // PATCH /lock-contracts/:slug — bumps version + writes revision
  app.patch('/lock-contracts/:slug', async (c) => {
    const slug = c.req.param('slug');
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const existing = db.select().from(lockContracts).where(eq(lockContracts.slug, slug)).get();
    if (!existing) return c.json({ error: 'not found' }, 404);

    const newBody = (body['body_md'] as string | undefined) ?? existing.bodyMd;
    const nextVersion = existing.version + 1;
    const updates = {
      bodyMd: newBody,
      version: nextVersion,
      updatedAt: now,
      checksum: sha256(newBody),
      ...(body['title'] !== undefined ? { title: body['title'] as string } : {}),
      ...(body['active'] !== undefined ? { active: body['active'] as boolean } : {}),
    };

    const sqlite = getSqliteRaw();
    const tx = sqlite.transaction(() => {
      db.update(lockContracts).set(updates).where(eq(lockContracts.slug, slug)).run();
      sqlite.prepare(`
        INSERT INTO lock_contract_revisions (contract_id, version, body_md, changed_at, changed_by)
        VALUES (?, ?, ?, ?, 'system')
      `).run(existing.id, nextVersion, newBody, now);
      sqlite.prepare(`
        INSERT INTO timeline_events (id, kind, actor, summary, subject_id, subject_kind, payload, created_at)
        VALUES (?, 'lock_contract.updated', 'system', ?, ?, 'lock_contract', ?, ?)
      `).run('tl_' + nanoid(8), `Lock contract v${nextVersion}: ${slug}`, existing.id, JSON.stringify({ version: nextVersion }), now);
    });
    tx();
    return c.json({ ok: true, version: nextVersion });
  });

  // GET /memory-anchors
  app.get('/memory-anchors', (c) => {
    return c.json(db.select().from(memoryAnchors).all());
  });

  // POST /memory-anchors
  app.post('/memory-anchors', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const row = {
      path: body['path'] as string,
      kind: (body['kind'] as string) ?? 'lock_contract',
      refId: body['ref_id'] as string,
      refTable: body['ref_table'] as string,
      lastSyncedAt: now,
      checksumAtSync: (body['checksum_at_sync'] as string) ?? '',
    };
    db.insert(memoryAnchors).values(row).onConflictDoUpdate({ target: memoryAnchors.path, set: { lastSyncedAt: now, checksumAtSync: row.checksumAtSync } }).run();
    return c.json(row, 201);
  });

  // GET /db-backups
  app.get('/db-backups', (c) => {
    return c.json(db.select().from(dbBackups).orderBy(desc(dbBackups.takenAt)).limit(50).all());
  });

  // POST /db-backups — record a backup catalog entry
  app.post('/db-backups', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const row = {
      takenAt: now,
      path: body['path'] as string,
      sizeBytes: (body['size_bytes'] as number) ?? 0,
      rowCountsJson: JSON.stringify(body['row_counts'] ?? {}),
      checksum: (body['checksum'] as string) ?? '',
    };
    const result = db.insert(dbBackups).values(row).returning().get();
    return c.json(result, 201);
  });
}
