import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { eq, and, count } from 'drizzle-orm';
import { getDb, runMigrations } from '../db/connection';
import type { Db } from '../db/connection';
import { seedProjects } from '../db/seed-projects';
import { seedAdr011 } from '../db/seed-adr';
import { seedFeatures } from '../db/seed-features';
import { seedSuggestions } from '../db/seed-suggestions';
import { migrateFromJsonl } from '../db/migrate-from-jsonl';
import { attachWsServer } from '../ws/index';
import { createApp } from './app';
import { wireEventBus, eventBus } from '../events/bus-adapter';
import { wirePhase2 } from '../agents/wire-phase2';
import type { Phase2Context } from '../agents/wire-phase2';
// FREG-003: subscribe FeatureRegistryWriter to story.completed at boot.
import { registerFeatureRegistryWriter } from '../agents/feature-registry-writer';
import { subscribeToEvents as subscribePriorityEvents, scoreAll } from '../prioritization/reprioritizer';
import { tasks, executorRuns } from '../db/schema';

const HTTP_PORT = parseInt(process.env['CONDUCTOR_HTTP_PORT'] ?? '7776', 10);

// DASH-106: heartbeat cadence. 5s matches the gap-analysis spec and gives
// the dashboard a "live" signal without flooding the WS. Disable in tests
// or local dev with CAIA_HEARTBEAT_DISABLED=1 if needed.
const HEARTBEAT_INTERVAL_MS = parseInt(process.env['CAIA_HEARTBEAT_INTERVAL_MS'] ?? '5000', 10);
const HEARTBEAT_DISABLED = process.env['CAIA_HEARTBEAT_DISABLED'] === '1';
const DAEMON_HEARTBEAT_FILE = path.join(os.homedir(), '.conductor', 'executor.heartbeat');

interface DaemonHeartbeat {
  at: string;
  pid: number;
  running: number;
  queued: number;
}

function readDaemonHeartbeat(): DaemonHeartbeat | null {
  try {
    const raw = fs.readFileSync(DAEMON_HEARTBEAT_FILE, 'utf8');
    return JSON.parse(raw) as DaemonHeartbeat;
  } catch {
    return null;
  }
}

/**
 * DASH-106: emit `executor.heartbeat` at a fixed cadence. Reads counts from
 * the orchestrator's own DB (so the event is meaningful even when the
 * external daemon is down) and merges in the daemon's heartbeat file when
 * present (so the dashboard can tell daemon-alive from orchestrator-alive).
 * The event is `severity: 'debug'` per taxonomy — chatty by design but
 * cheap to filter out.
 */
export function emitExecutorHeartbeat(db: Db): void {
  try {
    const runningRow = db.select({ c: count() })
      .from(executorRuns)
      .where(eq(executorRuns.status, 'running'))
      .get();
    const running = runningRow?.c ?? 0;

    const queuedRow = db.select({ c: count() })
      .from(tasks)
      .where(and(eq(tasks.status, 'queued'), eq(tasks.paused, false)))
      .get();
    const queued = queuedRow?.c ?? 0;

    const daemon = readDaemonHeartbeat();

    eventBus.publish({
      type: 'executor.heartbeat',
      actor: 'system',
      severity: 'debug',
      payload: {
        pid: daemon?.pid ?? null,
        active_workers: running,
        queued_tasks: queued,
        daemon_alive: daemon !== null,
        last_daemon_heartbeat_at: daemon?.at ?? null,
      },
    });
  } catch (err) {
    // Heartbeat is best-effort observability — never crash the server over it.
    console.error('[caia] executor.heartbeat emit failed:', err);
  }
}

export async function startApiServer(conductorDir?: string): Promise<{ stop: () => void }> {
  runMigrations();
  const db = getDb();

  // Wire event bus to DB before any seeds or route handlers
  wireEventBus(db);

  await seedProjects(db);
  await seedAdr011(db);

  // DASH-302/303: backfill /features and /suggestions so the dashboard's
  // empty state isn't permanent. Both seeders are idempotent (slug-keyed
  // via a comment marker) and depend on seedProjects having run, so the
  // ordering matters. Real features/suggestions emitted by future
  // pipeline subsystems will simply append on top of these seeds.
  const featResult = await seedFeatures(db);
  const sugResult = await seedSuggestions(db);
  if (featResult.inserted > 0 || sugResult.inserted > 0) {
    console.error(`[conductor] Seeded ${featResult.inserted} features, ${sugResult.inserted} suggestions (${featResult.skipped} + ${sugResult.skipped} already present)`);
  }

  const { migrated } = await migrateFromJsonl(db, conductorDir);
  if (migrated > 0) {
    console.error(`[conductor] Migrated ${migrated} records from JSONL to SQLite`);
  }

  // CODING-007: wire Phase 2 task-manager subsystem (registry, ready-pool
  // consumer, backpressure monitor, health-metrics emitter) before
  // createApp so worker lifecycle routes can route through the registry.
  // Set CAIA_PHASE2_DISABLED=1 to opt out (legacy behaviour: lifecycle
  // endpoints fall back to direct DB writes without bus events).
  const PHASE2_DISABLED = process.env['CAIA_PHASE2_DISABLED'] === '1';
  let phase2: Phase2Context | undefined;
  if (!PHASE2_DISABLED) {
    phase2 = wirePhase2(db);
    console.error('[conductor] Phase 2 task-manager wired (registry + consumer + monitor + emitter)');
  }

  const app = createApp(db, { phase2 });

  // Wire continuous reprioritization before server starts handling requests
  subscribePriorityEvents(db);

  // FREG-003: wire the FeatureRegistryWriter so story.completed events
  // auto-populate the @chiefaia/feature-registry catalog. Skipped quietly
  // if the embedder (Ollama) is unreachable — the backfill script (FREG-004)
  // will catch up later.
  registerFeatureRegistryWriter();

  // Initial batch score of all unscored/stale tasks (fire-and-forget)
  scoreAll(db, 'system').catch(() => {});

  const server = serve({ fetch: app.fetch, port: HTTP_PORT }) as ServerType;

  attachWsServer(server as unknown as http.Server);

  eventBus.publish({
    type: 'system.startup',
    actor: 'system',
    payload: { component: 'conductor-api', version: '0.1.0', port: HTTP_PORT },
  });

  // DASH-106: start the executor.heartbeat ticker. unref() so it doesn't
  // hold the event loop open during graceful shutdown / Ctrl-C.
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (!HEARTBEAT_DISABLED) {
    heartbeatTimer = setInterval(() => emitExecutorHeartbeat(db), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }

  console.error(`[conductor] API + WS listening on port ${HTTP_PORT}`);

  return {
    stop: () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (phase2) phase2.stopAll();
      eventBus.publish({ type: 'system.shutdown', actor: 'system', payload: { component: 'conductor-api', reason: 'stop()' } });
      server.close();
    },
  };
}
