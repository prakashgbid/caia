/**
 * `/api/readyz` — readiness gate for the wizard app.
 *
 * Returns 200 only when the dependencies needed to serve a real
 * customer request are reachable:
 *
 *   - Postgres   (always required — tenant lookup runs on every page)
 *   - Infisical  (always required — per-tenant secrets resolve here)
 *   - NATS       (only if BUS_BACKEND_NATS_FOR_EVENT_TYPES is set —
 *                 V1 keeps it empty until the operator flips the flag)
 *
 * Returns 503 otherwise. Each check has a hard 2-second budget so a
 * stalled dep cannot freeze the probe past the K8s readiness window.
 *
 * Reuse-first: we use `getPool()` from `lib/tenants/wire` (the same
 * pg.Pool the middleware uses) — we don't open a parallel connection
 * pool just for the probe.
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
    const url = `${baseUrl.replace(/\/+$/, '')}/api/status`;
    const res = await withTimeout(
      fetch(url, { method: 'GET' }),
      CHECK_TIMEOUT_MS,
      'infisical',
    );
    if (res.ok || res.status === 401) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkNats(): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  const routed = process.env.BUS_BACKEND_NATS_FOR_EVENT_TYPES ?? '';
  if (routed.trim() === '') return { ok: true, skipped: true };
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
    service: 'chiefaia-wizard',
    checks: { postgres: pg, infisical, nats },
  };

  if (!ok) {
    console.warn(JSON.stringify({ event: 'readyz.fail', ...body }));
  }

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
