import { createLogger } from '@chiefaia/logger';
import { runSentinel } from './sentinel';

const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CONDUCTOR_API = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

// Structured logger (PR #478 logger first-wave migration). Wraps pino with
// a `component=daemon` binding so log aggregation can attribute these lines.
const log = createLogger({
  name: 'completeness-sentinel',
  level: (process.env['SENTINEL_LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
}).child({ component: 'daemon' });

async function tick(): Promise<void> {
  const sweepStart = Date.now();
  log.info('sweep starting', { ts: new Date().toISOString() });
  try {
    const results = await runSentinel();
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    log.info('sweep complete', {
      passed,
      failed,
      total: results.length,
      duration_ms: Date.now() - sweepStart,
    });
    await fetch(`${CONDUCTOR_API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'completeness.sweep_completed',
        actor: 'completeness-sentinel',
        payload: { entities_total: results.length, entities_passed: passed, entities_failed: failed, duration_ms: Date.now() - sweepStart },
      }),
    });
  } catch (err) {
    log.error('sweep error', { err: err instanceof Error ? err.message : String(err) });
  }
}

// Run immediately on start
tick();

// Then every 2 hours
setInterval(tick, INTERVAL_MS);
