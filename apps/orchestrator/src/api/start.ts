import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import * as http from 'http';
import { getDb, runMigrations } from '../db/connection';
import { seedProjects } from '../db/seed-projects';
import { seedAdr011 } from '../db/seed-adr';
import { seedFeatures } from '../db/seed-features';
import { seedSuggestions } from '../db/seed-suggestions';
import { migrateFromJsonl } from '../db/migrate-from-jsonl';
import { attachWsServer } from '../ws/index';
import { createApp } from './app';
import { wireEventBus, eventBus } from '../events/bus-adapter';
import { subscribeToEvents as subscribePriorityEvents, scoreAll } from '../prioritization/reprioritizer';

const HTTP_PORT = parseInt(process.env['CONDUCTOR_HTTP_PORT'] ?? '7776', 10);

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

  const app = createApp(db);

  // Wire continuous reprioritization before server starts handling requests
  subscribePriorityEvents(db);

  // Initial batch score of all unscored/stale tasks (fire-and-forget)
  scoreAll(db, 'system').catch(() => {});

  const server = serve({ fetch: app.fetch, port: HTTP_PORT }) as ServerType;

  attachWsServer(server as unknown as http.Server);

  eventBus.publish({
    type: 'system.startup',
    actor: 'system',
    payload: { component: 'conductor-api', version: '0.1.0', port: HTTP_PORT },
  });

  console.error(`[conductor] API + WS listening on port ${HTTP_PORT}`);

  return {
    stop: () => {
      eventBus.publish({ type: 'system.shutdown', actor: 'system', payload: { component: 'conductor-api', reason: 'stop()' } });
      server.close();
    },
  };
}
