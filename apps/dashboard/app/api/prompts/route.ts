/**
 * Dashboard API proxy: POST /api/prompts
 *
 * Forwards to the orchestrator's POST /prompts endpoint. Translates the
 * dashboard's wire shape (`text`, `projectId`, `priority`, `runMode`) to
 * the orchestrator's wire shape (`body`, metadata flags, `run_mode`).
 *
 * RUN-MODES (migration 0038): the dashboard's submit form has three
 * modes — full (default), plan-only, test-only. The frontend sends
 * `runMode` in the request body; this proxy maps it to the
 * orchestrator's `run_mode` field.
 */
import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

const VALID_RUN_MODES = new Set(['full', 'plan-only', 'test-only']);

export async function POST(req: Request): Promise<NextResponse> {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  const runMode = typeof payload.runMode === 'string' ? payload.runMode : undefined;
  if (runMode !== undefined && !VALID_RUN_MODES.has(runMode)) {
    return NextResponse.json(
      { error: `runMode must be one of ${[...VALID_RUN_MODES].join(', ')}` },
      { status: 400 },
    );
  }

  const upstreamBody = {
    body: text,
    received_via: 'chat',
    metadata: {
      projectId: payload.projectId ?? null,
      priority: payload.priority ?? 'normal',
      source: payload.source ?? 'dashboard',
      skipDecomposition: Boolean(payload.skipDecomposition),
    },
    ...(runMode ? { run_mode: runMode } : {}),
  };

  try {
    const upstream = await fetch(`${ORCHESTRATOR_URL}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamBody),
      cache: 'no-store',
    });
    const data = (await upstream.json()) as { id?: string; error?: string };
    if (!upstream.ok) {
      return NextResponse.json(
        { error: data.error ?? `Upstream ${upstream.status}` },
        { status: upstream.status },
      );
    }
    return NextResponse.json({
      prompt_id: data.id,
      correlation_id: data.id,
      run_mode: runMode ?? 'full',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'upstream unreachable' },
      { status: 502 },
    );
  }
}
