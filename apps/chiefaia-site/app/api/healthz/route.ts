/**
 * `/api/healthz` — pure liveness.
 *
 * Returns 200 + a small JSON envelope with the service identity and
 * process uptime. No I/O. K8s livenessProbe + the docker HEALTHCHECK
 * both target this endpoint.
 *
 * Versioning: we read chiefaia-site's package.json at module load
 * time. The value is captured ONCE per process, which is fine — pod
 * rolls re-import the route handler from scratch.
 *
 * Public path: chiefaia-site is not behind Cloudflare Access (only
 * the dashboard is), so no middleware exemption is required. We name
 * it `healthz` (not `health`) to match the K8s convention and the
 * orbit of other spine services (Tempo, NATS) so probe URLs are
 * uniform across the cluster.
 */

import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Standalone bundle ships package.json next to server.js, so the
// runtime cwd at `apps/chiefaia-site/` always has it. In dev mode
// Next.js runs from the same directory, so the same path works there too.
function readVersion(): string {
  try {
    const raw = readFileSync(
      join(process.cwd(), 'apps', 'chiefaia-site', 'package.json'),
      'utf-8',
    );
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    // dev path (cwd === apps/chiefaia-site) or the file is missing
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

// Force the Node runtime — readFileSync is unavailable on edge.
export const runtime = 'nodejs';
// Healthz must reflect the live process; no caching anywhere.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      service: 'chiefaia-site',
      version: VERSION,
      uptime: process.uptime(),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
