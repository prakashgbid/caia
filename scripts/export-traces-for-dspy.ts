// scripts/export-traces-for-dspy.ts
//
// Daily cron that pulls the last-24h traces from the self-hosted
// Langfuse stack (PR #261 obs-001) and writes them as JSONL rows
// at ~/.caia/traces/<YYYY-MM-DD>.jsonl, one row per (agent, llm-call)
// pair. This is the FEED the future DSPy compile job consumes.
//
// Row schema (one per emitted JSON line):
//   {
//     "trace_id":      string,
//     "agent_name":    string,
//     "agent_role":    string,
//     "task_type":     string,
//     "model":         string,
//     "prompt":        string,
//     "expected_output": string | null,
//     "actual_output": string,
//     "judge_score":   number | null,
//     "tokens": {
//       "input_tokens":  number,
//       "output_tokens": number,
//       "total_tokens":  number
//     },
//     "ok":            boolean,
//     "duration_ms":   number,
//     "timestamp":     string  // ISO 8601
//   }
//
// Reference: §6.10, §7 of
//   reports/caia-ai-tech-modernization-proposal-2026-04-30.md
// Sister PRs: #261 (obs-001), #262 (obs-002), #264 (obs-003).

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// ─── public types ────────────────────────────────────────────────
export interface DspyExportRow {
  trace_id: string;
  agent_name: string;
  agent_role: string;
  task_type: string;
  model: string;
  prompt: string;
  expected_output: string | null;
  actual_output: string;
  judge_score: number | null;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  ok: boolean;
  duration_ms: number;
  timestamp: string;
}

export interface LangfuseObservation {
  id: string;
  traceId?: string;
  type?: string;
  name?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown> | null;
  parentObservationId?: string | null;
  level?: string | null;
}

export interface LangfuseTrace {
  id: string;
  name?: string | null;
  timestamp?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface FetchOptions {
  host: string;
  publicKey: string;
  secretKey: string;
  fromIso: string;
  toIso: string;
  pageSize?: number;
  /** Override fetch — for tests. */
  fetchImpl?: typeof fetch;
}

// ─── helpers ─────────────────────────────────────────────────────

function attr<T = unknown>(
  meta: Record<string, unknown> | null | undefined,
  key: string,
): T | undefined {
  if (!meta) return undefined;
  const v = (meta as Record<string, unknown>)[key];
  return v as T | undefined;
}

function asStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function asNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Walk the (trace, observations) pairs from Langfuse and emit one
 * DspyExportRow per agent observation that has at least one nested
 * llm.route observation under it. The agent span carries the role +
 * judge_score; the router span carries the model + tokens.
 *
 * Pure function — exported for unit tests.
 */
export function buildRowsFromTrace(
  trace: LangfuseTrace,
  observations: LangfuseObservation[],
): DspyExportRow[] {
  const rows: DspyExportRow[] = [];
  const byParent = new Map<string, LangfuseObservation[]>();
  for (const o of observations) {
    const p = o.parentObservationId ?? '__root';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(o);
  }

  // Agent observations have name like "agent.<name>".
  const agents = observations.filter((o) =>
    typeof o.name === 'string' && o.name.startsWith('agent.'),
  );

  for (const agent of agents) {
    const agentMeta = agent.metadata ?? {};
    const children = byParent.get(agent.id) ?? [];
    // The router span(s) under the agent.
    const routers = children.filter((c) =>
      typeof c.name === 'string' && c.name.startsWith('llm.route'),
    );
    // If no router child, still emit one row with empty model/tokens.
    const target = routers.length > 0 ? routers : [null as null];

    for (const router of target) {
      const meta = router?.metadata ?? {};
      const startMs = router?.startTime ? Date.parse(router.startTime) : Date.parse(agent.startTime ?? new Date().toISOString());
      const endMs = router?.endTime ? Date.parse(router.endTime) : Date.parse(agent.endTime ?? new Date().toISOString());
      const computedDuration =
        Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(0, endMs - startMs)
          : 0;

      rows.push({
        trace_id: trace.id,
        agent_name: asStr(attr(agentMeta, 'agent.name') ?? agent.name?.replace(/^agent\./, '') ?? 'unknown'),
        agent_role: asStr(attr(agentMeta, 'agent.role') ?? 'unknown'),
        task_type: asStr(attr(meta, 'caia.task_type') ?? attr(agentMeta, 'agent.role') ?? 'unknown'),
        model: asStr(
          attr(meta, 'gen_ai.response.model') ??
            attr(meta, 'gen_ai.request.model') ??
            'unknown',
        ),
        prompt: asStr(router?.input ?? agent.input ?? ''),
        expected_output: agent.metadata && 'expected_output' in agent.metadata
          ? asStr((agent.metadata as Record<string, unknown>).expected_output)
          : null,
        actual_output: asStr(router?.output ?? agent.output ?? ''),
        judge_score:
          attr<number | string>(agentMeta, 'agent.judge_score') !== undefined
            ? asNum(attr(agentMeta, 'agent.judge_score'))
            : null,
        tokens: {
          input_tokens: asNum(attr(meta, 'gen_ai.usage.input_tokens')),
          output_tokens: asNum(attr(meta, 'gen_ai.usage.output_tokens')),
          total_tokens: asNum(attr(meta, 'gen_ai.usage.total_tokens')),
        },
        ok: attr<boolean>(agentMeta, 'agent.ok') ?? true,
        duration_ms: asNum(attr(agentMeta, 'agent.duration_ms')) || computedDuration,
        timestamp:
          (router?.startTime as string | undefined) ??
          (agent.startTime as string | undefined) ??
          (trace.timestamp as string | undefined) ??
          new Date().toISOString(),
      });
    }
  }

  return rows;
}

/**
 * Format an array of rows into JSONL (one JSON object per line, trailing
 * newline). Pure for unit tests.
 */
export function rowsToJsonl(rows: DspyExportRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

/**
 * Resolve the export path for a given UTC date — typically
 * ~/.caia/traces/YYYY-MM-DD.jsonl. Pure for unit tests.
 */
export function exportPathFor(date: Date, root: string = join(homedir(), '.caia', 'traces')): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return join(root, `${y}-${m}-${d}.jsonl`);
}

/**
 * Page through Langfuse's /api/public/traces + /api/public/observations
 * for the date window, build rows, write them. Returns the number of
 * rows written + the output path.
 */
export async function fetchAndWriteRows(
  opts: FetchOptions,
  outPath?: string,
): Promise<{ rowsWritten: number; path: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const auth = Buffer.from(`${opts.publicKey}:${opts.secretKey}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}` };
  const pageSize = opts.pageSize ?? 100;

  // 1. List traces in the window.
  const tracesUrl = new URL(`${opts.host}/api/public/traces`);
  tracesUrl.searchParams.set('fromTimestamp', opts.fromIso);
  tracesUrl.searchParams.set('toTimestamp', opts.toIso);
  tracesUrl.searchParams.set('limit', String(pageSize));
  const tracesRes = await fetchImpl(tracesUrl.toString(), { headers });
  if (!tracesRes.ok) {
    throw new Error(`Langfuse traces API returned ${tracesRes.status}`);
  }
  const tracesBody = (await tracesRes.json()) as { data?: LangfuseTrace[] };
  const traces = tracesBody.data ?? [];

  // 2. For each trace, list observations + build rows.
  const rows: DspyExportRow[] = [];
  for (const trace of traces) {
    const obsUrl = new URL(`${opts.host}/api/public/observations`);
    obsUrl.searchParams.set('traceId', trace.id);
    obsUrl.searchParams.set('limit', String(pageSize));
    const obsRes = await fetchImpl(obsUrl.toString(), { headers });
    if (!obsRes.ok) continue;
    const obsBody = (await obsRes.json()) as { data?: LangfuseObservation[] };
    const observations = obsBody.data ?? [];
    rows.push(...buildRowsFromTrace(trace, observations));
  }

  // 3. Write JSONL.
  const path = outPath ?? exportPathFor(new Date());
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(path, rowsToJsonl(rows), 'utf8');
  return { rowsWritten: rows.length, path };
}

// ─── CLI entry-point ─────────────────────────────────────────────
//
// Run via: tsx scripts/export-traces-for-dspy.ts
// Or via launchd at 03:00 UTC daily — see the plist in
// scripts/export-traces-for-dspy.plist.
//
// Required env:
//   LANGFUSE_HOST          (default http://localhost:3001)
//   LANGFUSE_PUBLIC_KEY
//   LANGFUSE_SECRET_KEY
// Optional:
//   CAIA_TRACES_DIR        (default ~/.caia/traces)
//   EXPORT_LOOKBACK_HOURS  (default 24)

async function cliMain(): Promise<void> {
  const host = process.env['LANGFUSE_HOST'] ?? 'http://localhost:3001';
  const publicKey = process.env['LANGFUSE_PUBLIC_KEY'] ?? '';
  const secretKey = process.env['LANGFUSE_SECRET_KEY'] ?? '';
  const root = process.env['CAIA_TRACES_DIR'] ?? join(homedir(), '.caia', 'traces');
  const lookbackHrs = Number(process.env['EXPORT_LOOKBACK_HOURS'] ?? 24);

  if (!publicKey || !secretKey) {
    console.error(
      'export-traces-for-dspy: missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY env',
    );
    process.exit(2);
  }

  const to = new Date();
  const from = new Date(to.getTime() - lookbackHrs * 3600 * 1000);
  const out = exportPathFor(to, root);

  const { rowsWritten, path } = await fetchAndWriteRows(
    {
      host,
      publicKey,
      secretKey,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
    },
    out,
  );
  console.log(
    `export-traces-for-dspy: wrote ${rowsWritten} rows to ${path}`,
  );
}

if (require.main === module) {
  cliMain().catch((err) => {
    console.error('export-traces-for-dspy failed:', err);
    process.exit(1);
  });
}
