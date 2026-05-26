/**
 * `/api/healthz` — pure liveness.
 *
 * Returns 200 + a small JSON envelope with the service identity and
 * process uptime. No I/O. K8s livenessProbe + the docker HEALTHCHECK
 * both target this endpoint.
 *
 * Versioning: we read the wizard's package.json at module load
 * time. The value is captured ONCE per process, which is fine — pod
 * rolls re-import the route handler from scratch.
 *
 * Public path: bypassed by the Cloudflare-Access middleware via the
 * `(?!.../api/health…)` matcher exclusion.
 */

import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readVersion(): string {
  try {
    const raw = readFileSync(
      join(process.cwd(), 'apps', 'wizard', 'package.json'),
      'utf-8',
    );
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    try {
      const raw = readFileSync(
        join(process.cwd(), 'package.json'),
        'utf-8',
      );
      return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}

const VERSION = readVersion();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      service: 'chiefaia-wizard',
      version: VERSION,
      uptime: process.uptime(),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
