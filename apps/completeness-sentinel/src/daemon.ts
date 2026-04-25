import { runSentinel } from './sentinel';

const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CONDUCTOR_API = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

async function tick(): Promise<void> {
  const sweepStart = Date.now();
  console.log(`[completeness-sentinel] ${new Date().toISOString()} — starting sweep`);
  try {
    const results = await runSentinel();
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    console.log(`[completeness-sentinel] Sweep complete: ${passed} pass, ${failed} fail, ${results.length} total`);
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
    console.error('[completeness-sentinel] Sweep error:', err);
  }
}

// Run immediately on start
tick();

// Then every 2 hours
setInterval(tick, INTERVAL_MS);
