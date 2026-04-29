/**
 * Workers routes — TASKMGR-006.
 *
 * Surfaces the Phase 2 worker pool + per-bucket health metrics to the
 * dashboard. Read-only — workers self-register via the WorkerPoolRegistry
 * (TASKMGR-002); these endpoints are pure projections.
 *
 * Endpoints:
 *   GET /api/workers/summary           — aggregate counts + per-bucket cards
 *   GET /api/workers/list              — every worker row with current status
 *   GET /api/workers/health/:bucketId  — last 60 entries of bucket_health_history
 *
 * The frontend dashboard (apps/dashboard/app/workers/page.tsx — to be
 * shipped in a follow-up UI PR) polls /summary every 5s for the overview
 * and /health/:bucketId every 30s for the per-bucket sparkline.
 */

import type { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { workerPool, bucketHealthHistory, stories } from '../../db/schema';

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

export function registerWorkerRoutes(app: Hono, db: Db): void {
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
}
