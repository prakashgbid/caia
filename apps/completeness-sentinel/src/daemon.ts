import { createServer } from 'node:http';
import { runSentinel } from './sentinel';
import {
  sentinelRegistry,
  sweepsTotal,
  sweepDurationMs,
  lastSweepScorePct,
  lastSweepEntities,
} from './metrics';

const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CONDUCTOR_API = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';
const METRICS_PORT = parseInt(process.env['SENTINEL_METRICS_PORT'] ?? '9101', 10);

async function tick(): Promise<void> {
  const sweepStart = Date.now();
  console.log(`[completeness-sentinel] ${new Date().toISOString()} — starting sweep`);
  try {
    const results = await runSentinel();
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const durationMs = Date.now() - sweepStart;

    console.log(`[completeness-sentinel] Sweep complete: ${passed} pass, ${failed} fail, ${results.length} total`);

    sweepsTotal.inc({ status: failed > 0 ? 'partial' : 'ok' });
    sweepDurationMs.observe(durationMs);

    // Update last-sweep score gauges per entity kind
    const byKind = new Map<string, number[]>();
    for (const r of results) {
      const list = byKind.get(r.entityKind) ?? [];
      list.push(r.scorePct);
      byKind.set(r.entityKind, list);
    }
    for (const [kind, scores] of byKind) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      lastSweepScorePct.set({ kind }, Math.round(avg));
      lastSweepEntities.set({ kind }, scores.length);
    }

    await fetch(`${CONDUCTOR_API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'completeness.sweep_completed',
        actor: 'completeness-sentinel',
        payload: { entities_total: results.length, entities_passed: passed, entities_failed: failed, duration_ms: durationMs },
      }),
    });
  } catch (err) {
    sweepsTotal.inc({ status: 'error' });
    console.error('[completeness-sentinel] Sweep error:', err);
  }
}

// Lightweight metrics HTTP server
const metricsServer = createServer(async (req, res) => {
  if (req.url === '/metrics' || req.url === '/prom-metrics') {
    const metrics = await sentinelRegistry.metrics();
    res.writeHead(200, { 'Content-Type': sentinelRegistry.contentType });
    res.end(metrics);
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'completeness-sentinel' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

metricsServer.listen(METRICS_PORT, () => {
  console.log(`[completeness-sentinel] Metrics server listening on :${METRICS_PORT}`);
});

// Run immediately on start
tick();

// Then every 2 hours
setInterval(tick, INTERVAL_MS);
