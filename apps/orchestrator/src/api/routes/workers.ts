/**
 * Workers routes — TASKMGR-006 + CODING-007.
 *
 * Surfaces the Phase 2 worker pool + per-bucket health metrics to the
 * dashboard, and exposes the lifecycle API workers use to register +
 * heartbeat + poll for assignments + release.
 *
 * Read endpoints (TASKMGR-006):
 *   GET /api/workers/summary            — aggregate counts + per-bucket cards
 *   GET /api/workers/list               — every worker row with current status
 *   GET /api/workers/health/:bucketId   — last 60 entries of bucket_health_history
 *
 * Lifecycle endpoints (CODING-007):
 *   POST /api/workers/register          — { kind, capabilities, socketPath, metadata? }
 *                                         → { workerId }
 *   POST /api/workers/:id/heartbeat     → { ok, status, currentStoryId }
 *   POST /api/workers/:id/release       → { ok }
 *   GET  /api/workers/:id/assignment    → { assignment: { storyId, bucketId, assignedAt } | null }
 *
 * The lifecycle endpoints accept an optional `WorkerPoolRegistry` so the
 * route handlers go through the registry's emit-events code path, falling
 * back to direct DB writes when the registry isn't wired (legacy / test).
 *
 * Shape of an assignment row: it's just stories.assignedWorkerId === id +
 * status='pending' AND assignedAt = the row's updatedAt; we read the
 * worker's currentStoryId (set by ReadyPoolConsumer.atomicAssign) to
 * locate it.
 */

import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { workerPool, bucketHealthHistory, stories } from '../../db/schema';
import type {
  WorkerPoolRegistry,
  WorkerKind,
  WorkerReleaseReason,
} from '../../agents/worker-pool-registry';

interface WorkerOut {
  id: string;
  kind: string;
  capabilities: string[];
  status: string;
  currentStoryId: string | null;
  lastHeartbeatAt: number;
  registeredAt: number;
  releasedAt: number | null;
  uptimeMs: number | null;        // when status='busy', heartbeat - registered
  metadata: Record<string, unknown>;
}

interface BucketCardOut {
  bucketId: string;
  queueDepth: number;
  throughputPerHour: number;
  oldestReadyAgeS: number | null;
  workersAssigned: number;
  engaged: boolean;
  ts: number;
}

interface SummaryOut {
  counts: { idle: number; busy: number; crashed: number; released: number };
  perBucket: BucketCardOut[];
  generatedAt: number;
}

interface HealthOut {
  bucketId: string;
  series: Array<{
    ts: number;
    queueDepth: number;
    throughputPerHour: number;
    oldestReadyAgeS: number | null;
    workersAssigned: number;
    engaged: boolean;
  }>;
}

function safeJsonArray(s: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(s ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(s: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toWorkerOut(r: typeof workerPool.$inferSelect): WorkerOut {
  return {
    id: r.id,
    kind: r.kind,
    capabilities: safeJsonArray(r.capabilitiesJson),
    status: r.status,
    currentStoryId: r.currentStoryId ?? null,
    lastHeartbeatAt: r.lastHeartbeatAt,
    registeredAt: r.registeredAt,
    releasedAt: r.releasedAt ?? null,
    uptimeMs: r.status === 'busy' ? r.lastHeartbeatAt - r.registeredAt : null,
    metadata: safeJsonObject(r.metadataJson),
  };
}

export interface WorkerRoutesOptions {
  /** When provided, lifecycle endpoints route through the registry so
   *  worker.* events are emitted on the bus. Read endpoints don't need it. */
  registry?: WorkerPoolRegistry;
}

export function registerWorkerRoutes(app: Hono, db: Db, opts: WorkerRoutesOptions = {}): void {
  const registry = opts.registry;

  // GET /api/workers/summary
  app.get('/api/workers/summary', (c) => {
    const allWorkers = db.select().from(workerPool).all();
    const counts = { idle: 0, busy: 0, crashed: 0, released: 0 };
    for (const w of allWorkers) {
      const s = w.status as keyof typeof counts;
      if (s in counts) counts[s] = (counts[s] ?? 0) + 1;
    }
    // For perBucket we read the most recent bucket_health_history row per bucket.
    // SQLite doesn't have window functions everywhere; do it in-process.
    const allHealth = db
      .select()
      .from(bucketHealthHistory)
      .orderBy(desc(bucketHealthHistory.ts))
      .limit(500)
      .all();
    const seen = new Set<string>();
    const perBucket: BucketCardOut[] = [];
    for (const r of allHealth) {
      if (seen.has(r.bucketId)) continue;
      seen.add(r.bucketId);
      perBucket.push({
        bucketId: r.bucketId,
        queueDepth: r.queueDepth,
        throughputPerHour: r.throughputPerHour,
        oldestReadyAgeS: r.oldestReadyAgeS,
        workersAssigned: r.workersAssigned,
        engaged: r.engaged === 1,
        ts: r.ts,
      });
    }
    perBucket.sort((a, b) => b.queueDepth - a.queueDepth);
    const out: SummaryOut = { counts, perBucket, generatedAt: Date.now() };
    return c.json(out);
  });

  // GET /api/workers/list
  app.get('/api/workers/list', (c) => {
    const rows = db
      .select()
      .from(workerPool)
      .orderBy(desc(workerPool.registeredAt))
      .all();
    return c.json({ workers: rows.map(toWorkerOut), total: rows.length });
  });

  // GET /api/workers/health/:bucketId
  app.get('/api/workers/health/:bucketId', (c) => {
    const bucketId = c.req.param('bucketId');
    const rows = db
      .select()
      .from(bucketHealthHistory)
      .where(eq(bucketHealthHistory.bucketId, bucketId))
      .orderBy(desc(bucketHealthHistory.ts))
      .limit(60)
      .all();
    const out: HealthOut = {
      bucketId,
      series: rows
        .reverse()
        .map((r) => ({
          ts: r.ts,
          queueDepth: r.queueDepth,
          throughputPerHour: r.throughputPerHour,
          oldestReadyAgeS: r.oldestReadyAgeS,
          workersAssigned: r.workersAssigned,
          engaged: r.engaged === 1,
        })),
    };
    return c.json(out);
  });

  // ─── Lifecycle endpoints (CODING-007) ─────────────────────────────────────

  // POST /api/workers/register
  app.post('/api/workers/register', async (c) => {
    let body: {
      kind?: WorkerKind;
      capabilities?: string[];
      socketPath?: string;
      metadata?: Record<string, unknown>;
      id?: string;
    } = {};
    try { body = await c.req.json(); } catch { /* ignore */ }
    if (!body.kind || (body.kind !== 'coding' && body.kind !== 'fix-it')) {
      return c.json({ error: 'kind must be "coding" or "fix-it"' }, 400);
    }
    if (!body.socketPath || typeof body.socketPath !== 'string') {
      return c.json({ error: 'socketPath is required' }, 400);
    }
    const metadata = { ...(body.metadata ?? {}), socketPath: body.socketPath };
    if (registry) {
      const rec = registry.register({
        kind: body.kind,
        capabilities: body.capabilities ?? [],
        metadata,
        id: body.id,
      });
      return c.json({ workerId: rec.id });
    }
    // Fallback: write directly to DB without bus events.
    const id = body.id ?? `wkr_${Math.random().toString(36).slice(2, 14)}`;
    const ts = Date.now();
    db.insert(workerPool).values({
      id,
      kind: body.kind,
      capabilitiesJson: JSON.stringify(body.capabilities ?? []),
      status: 'idle',
      currentStoryId: null,
      lastHeartbeatAt: ts,
      registeredAt: ts,
      releasedAt: null,
      metadataJson: JSON.stringify(metadata),
    }).run();
    return c.json({ workerId: id });
  });

  // POST /api/workers/:id/heartbeat
  app.post('/api/workers/:id/heartbeat', (c) => {
    const id = c.req.param('id');
    let ok = false;
    if (registry) {
      ok = registry.heartbeat(id);
    } else {
      const row = db.select().from(workerPool).where(eq(workerPool.id, id)).get();
      if (row && row.status !== 'released') {
        db.update(workerPool).set({ lastHeartbeatAt: Date.now() }).where(eq(workerPool.id, id)).run();
        ok = true;
      }
    }
    if (!ok) return c.json({ ok: false, error: 'worker not found or released' }, 404);
    const row = db.select().from(workerPool).where(eq(workerPool.id, id)).get();
    return c.json({
      ok: true,
      status: row?.status ?? 'unknown',
      currentStoryId: row?.currentStoryId ?? null,
    });
  });

  // GET /api/workers/:id/assignment
  app.get('/api/workers/:id/assignment', (c) => {
    const id = c.req.param('id');
    const row = db.select().from(workerPool).where(eq(workerPool.id, id)).get();
    if (!row) return c.json({ error: 'worker not found' }, 404);
    if (!row.currentStoryId) return c.json({ assignment: null });
    const story = db.select().from(stories).where(eq(stories.id, row.currentStoryId)).get();
    if (!story) return c.json({ assignment: null });
    return c.json({
      assignment: {
        storyId: story.id,
        bucketId: story.bucketId ?? null,
        // ReadyPoolConsumer doesn't currently stamp an assignment timestamp on
        // the story; surface the worker's heartbeat (which atomicAssign sets
        // to ts at the moment of assignment) as a stable proxy.
        assignedAt: row.lastHeartbeatAt,
      },
    });
  });

  // POST /api/workers/:id/release
  app.post('/api/workers/:id/release', async (c) => {
    const id = c.req.param('id');
    let body: { reason?: WorkerReleaseReason } = {};
    try { body = await c.req.json(); } catch { /* ignore */ }
    if (registry) {
      try {
        registry.release(id, body.reason ?? 'manual-shutdown');
      } catch (e) {
        return c.json({ ok: false, error: (e as Error).message }, 404);
      }
    } else {
      const row = db.select().from(workerPool).where(eq(workerPool.id, id)).get();
      if (!row) return c.json({ ok: false, error: 'worker not found' }, 404);
      const ts = Date.now();
      db.update(workerPool)
        .set({ status: 'released', releasedAt: ts, lastHeartbeatAt: ts })
        .where(eq(workerPool.id, id))
        .run();
    }
    return c.json({ ok: true });
  });
}
