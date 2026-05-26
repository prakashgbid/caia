/**
 * `/api/readyz` — readiness gate.
 *
 * Returns 200 only when the dependencies the dashboard needs to serve
 * a real request are reachable:
 *
 *   - Postgres   (always required — tenant lookup runs on every page)
 *   - Infisical  (always required — per-tenant secrets resolve here)
 *   - NATS       (only if BUS_BACKEND_NATS_FOR_EVENT_TYPES is set —
 *                 V1 keeps it empty until Wave 1a flips a flag)
 *
 * Returns 503 otherwise. Each check has a hard 2-second budget so a
 * stalled dep cannot freeze the probe past the K8s readiness window.
 *
 * Reuse-first: we use `getPool()` from `lib/tenants/wire` (the same
 * pg.Pool the middleware uses) — we don't open a parallel connection
 * pool just for the probe. Infisical reachability is a HEAD request
 * to the base URL; NATS reachability is an HTTP GET of the monitor
 * endpoint exposed by the nats-server in our cluster (port 8222).
 *
 * The probe writes a single structured log line on every non-OK
 * verdict so operators can see which dep is regressing without
 * tailing pod stdout for failed connect attempts.
 */

import { NextResponse } from 'next/server';
import { getPool, getInfisicalOptions } from '../../../lib/tenants/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function checkPostgres(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pool = getPool();
    await withTimeout(pool.query('SELECT 1'), CHECK_TIMEOUT_MS, 'postgres');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkInfisical(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { baseUrl } = getInfisicalOptions();
  if (!baseUrl) {
    return { ok: false, error: 'INFISICAL_BASE_URL not configured' };
  }
  try {
    // Infisical exposes /api/status as a no-auth health probe.
    const url = `${baseUrl.replace(/\/+$/, '')}/api/status`;
    const res = await withTimeout(
      fetch(url, { method: 'GET' }),
      CHECK_TIMEOUT_MS,
      'infisical',
    );
    // 200..299 = healthy. Some Infisical builds return 401 from /api/status
    // when auth headers are required — that still proves reachability.
    if (res.ok || res.status === 401) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkNats(): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  // If the operator hasn't routed ANY event types to NATS yet, the
  // dashboard never opens a NATS connection — so its reachability is
  // not part of readiness. Default-empty means "skip".
  const routed = process.env.BUS_BACKEND_NATS_FOR_EVENT_TYPES ?? '';
  if (routed.trim() === '') return { ok: true, skipped: true };

  // We hit the NATS monitor port (8222) at the in-cluster Service host.
  // This avoids opening a real NATS client connection from the probe
  // path — cheaper and lets us bound the check to a single HTTP call.
  const monitor =
    process.env.NATS_MONITOR_URL ?? 'http://nats.chiefaia.svc.cluster.local:8222/healthz';
  try {
    const res = await withTimeout(fetch(monitor), CHECK_TIMEOUT_MS, 'nats');
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(): Promise<NextResponse> {
  const [pg, infisical, nats] = await Promise.all([
    checkPostgres(),
    checkInfisical(),
    checkNats(),
  ]);

  const ok = pg.ok && infisical.ok && nats.ok;
  const body = {
    ok,
    service: 'chiefaia-dashboard',
    checks: {
      postgres: pg,
      infisical,
      nats,
    },
  };

  if (!ok) {
    // Single structured line on every failure — easy to grep in pod logs.
    // We log via console.warn (no extra deps); production logs are
    // captured by the cluster log shipper.
    console.warn(JSON.stringify({ event: 'readyz.fail', ...body }));
  }

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
