#!/usr/bin/env node
/**
 * @caia/pipeline-conductor — projector-daemon.ts
 * launchd entrypoint. Per spec §13.2.
 */

import { Pool } from 'pg';
import { loadEscalationPolicies } from './escalation-policies.js';
import { Projector } from './projector.js';

const PG_DSN = process.env.PG_DSN;
const POLICY_PATH = process.env.CONDUCTOR_POLICY_PATH;

if (!PG_DSN) {
  console.error('[conductor-daemon] PG_DSN env var is required. Aborting.');
  process.exit(1);
}

const pool = new Pool({ connectionString: PG_DSN });

async function main(): Promise<void> {
  const policy = loadEscalationPolicies(POLICY_PATH);
  const projector = new Projector({ pool, policy });

  const startedAt = new Date().toISOString();
  const cursor = await projector.getCursor();
  console.log(`[conductor-daemon] starting at=${startedAt} cursor=${cursor ?? '(empty)'}`);

  projector.start();

  setInterval(() => {
    console.log(
      `[conductor-daemon] stats events=${projector.eventsObserved} ` +
        `refreshes=${projector.refreshCount} ` +
        `esc_opened=${projector.escalationsOpened} ` +
        `esc_closed=${projector.escalationsClosed}`,
    );
  }, 60_000);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[conductor-daemon] received ${signal}, stopping`);
    projector.stop();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[conductor-daemon] fatal', err);
  process.exit(1);
});
