/**
 * `/api/readyz` — readiness gate for the operator system dashboard.
 *
 * After the apps/wizard split (standing_rule_wizard_ops_app_split_2026-05-26),
 * this dashboard is operator-only at ops.chiefaia.com and no longer
 * owns tenant provisioning. The readiness signal therefore drops the
 * tenant-DB + Infisical checks that the wizard's readyz still runs.
 *
 * V1 of the operator dashboard reads only:
 *
 *   - NATS  (only if BUS_BACKEND_NATS_FOR_EVENT_TYPES is set — V1
 *            keeps it empty until the operator flips the flag)
 *
 * Returns 503 only if a required dep is unreachable. Each check has a
 * hard 2-second budget so a stalled dep cannot freeze the probe.
 */

import { NextResponse } from 'next/server';

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

async function checkNats(): Promise<
  { ok: true; skipped?: boolean } | { ok: false; error: string }
> {
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
  const [nats] = await Promise.all([checkNats()]);

  const ok = nats.ok;
  const body = {
    ok,
    service: 'chiefaia-dashboard',
    checks: { nats },
  };

  if (!ok) {
    console.warn(JSON.stringify({ event: 'readyz.fail', ...body }));
  }

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
