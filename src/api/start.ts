import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import * as http from 'http';
import { getDb, runMigrations } from '../db/connection';
import { seedProjects } from '../db/seed-projects';
import { seedAdr011 } from '../db/seed-adr';
import { migrateFromJsonl } from '../db/migrate-from-jsonl';
import { attachWsServer } from '../ws/index';
import { createApp } from './app';

const HTTP_PORT = parseInt(process.env['CONDUCTOR_HTTP_PORT'] ?? '7776', 10);

export async function startApiServer(conductorDir?: string): Promise<{ stop: () => void }> {
  runMigrations();
  const db = getDb();
  await seedProjects(db);
  await seedAdr011(db);

  const { migrated } = await migrateFromJsonl(db, conductorDir);
  if (migrated > 0) {
    console.error(`[conductor] Migrated ${migrated} records from JSONL to SQLite`);
  }

  const app = createApp(db);

  const server = serve({ fetch: app.fetch, port: HTTP_PORT }) as ServerType;

  // Attach WebSocket server to the same http.Server
  attachWsServer(server as unknown as http.Server);

  console.error(`[conductor] API + WS listening on port ${HTTP_PORT}`);

  return {
    stop: () => {
      server.close();
    },
  };
}
