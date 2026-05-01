// scripts/__tests__/export-traces-for-dspy.test.ts
//
// 8 vitest cases on the export logic.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildRowsFromTrace,
  exportPathFor,
  fetchAndWriteRows,
  rowsToJsonl,
  type DspyExportRow,
  type LangfuseObservation,
  type LangfuseTrace,
} from '../export-traces-for-dspy';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeAgentSpan(opts: {
  id: string;
  trace: string;
  name: string;
  role: string;
  duration?: number;
  ok?: boolean;
  judge?: number | null;
  startTime?: string;
  endTime?: string;
}): LangfuseObservation {
  return {
    id: opts.id,
    traceId: opts.trace,
    type: 'SPAN',
    name: `agent.${opts.name}`,
    startTime: opts.startTime ?? '2026-05-01T10:00:00Z',
    endTime: opts.endTime ?? '2026-05-01T10:00:01Z',
    parentObservationId: null,
    metadata: {
      'agent.name': opts.name,
      'agent.role': opts.role,
      'agent.duration_ms': opts.duration ?? 1234,
      'agent.ok': opts.ok ?? true,
      ...(opts.judge !== undefined ? { 'agent.judge_score': opts.judge } : {}),
    },
  };
}

function fakeRouterSpan(opts: {
  id: string;
  trace: string;
  parent: string;
  taskType: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  prompt?: string;
  output?: string;
  cacheHit?: boolean;
  startTime?: string;
  endTime?: string;
}): LangfuseObservation {
  return {
    id: opts.id,
    traceId: opts.trace,
    type: 'GENERATION',
    name: `llm.route ${opts.taskType}`,
    parentObservationId: opts.parent,
    startTime: opts.startTime ?? '2026-05-01T10:00:00.100Z',
    endTime: opts.endTime ?? '2026-05-01T10:00:00.500Z',
    input: opts.prompt ?? 'classify this',
    output: opts.output ?? 'auth',
    metadata: {
      'gen_ai.system': 'claude-binary',
      'gen_ai.request.model': opts.model,
      'gen_ai.response.model': opts.model,
      'gen_ai.usage.input_tokens': opts.inputTokens ?? 13,
      'gen_ai.usage.output_tokens': opts.outputTokens ?? 17,
      'gen_ai.usage.total_tokens': opts.totalTokens ?? 30,
      'caia.task_type': opts.taskType,
      'caia.route_decision': 'claude',
      'caia.cache_hit': opts.cacheHit ?? false,
    },
  };
}

describe('export-traces-for-dspy — buildRowsFromTrace', () => {
  // 1
  it('1. emits one row per (agent, router) pair', () => {
    const trace: LangfuseTrace = { id: 't-1', timestamp: '2026-05-01T10:00:00Z' };
    const agent = fakeAgentSpan({ id: 'a-1', trace: 't-1', name: 'po-agent', role: 'po-decomposer' });
    const router = fakeRouterSpan({ id: 'r-1', trace: 't-1', parent: 'a-1', taskType: 'po-decomposer-coverage-judge', model: 'claude-sonnet-4-6' });
    const rows = buildRowsFromTrace(trace, [agent, router]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trace_id).toBe('t-1');
    expect(rows[0]?.agent_name).toBe('po-agent');
    expect(rows[0]?.agent_role).toBe('po-decomposer');
    expect(rows[0]?.task_type).toBe('po-decomposer-coverage-judge');
    expect(rows[0]?.model).toBe('claude-sonnet-4-6');
  });

  // 2
  it('2. captures token usage from gen_ai.usage.* attrs', () => {
    const trace: LangfuseTrace = { id: 't-2' };
    const agent = fakeAgentSpan({ id: 'a-2', trace: 't-2', name: 'ba-agent', role: 'ba-enricher' });
    const router = fakeRouterSpan({
      id: 'r-2', trace: 't-2', parent: 'a-2',
      taskType: 'story-enrichment', model: 'qwen2.5-coder:7b',
      inputTokens: 41, outputTokens: 73, totalTokens: 114,
    });
    const rows = buildRowsFromTrace(trace, [agent, router]);
    expect(rows[0]?.tokens.input_tokens).toBe(41);
    expect(rows[0]?.tokens.output_tokens).toBe(73);
    expect(rows[0]?.tokens.total_tokens).toBe(114);
  });

  // 3
  it('3. captures judge_score when present, null otherwise', () => {
    const trace: LangfuseTrace = { id: 't-3' };
    const a1 = fakeAgentSpan({ id: 'a-3a', trace: 't-3', name: 'story-validator-agent', role: 'judge', judge: 0.87 });
    const a2 = fakeAgentSpan({ id: 'a-3b', trace: 't-3', name: 'po-agent', role: 'po-decomposer' });
    const r1 = fakeRouterSpan({ id: 'r-3a', trace: 't-3', parent: 'a-3a', taskType: 'judge', model: 'claude-sonnet-4-6' });
    const r2 = fakeRouterSpan({ id: 'r-3b', trace: 't-3', parent: 'a-3b', taskType: 'po-decomposer-story', model: 'qwen3:14b' });
    const rows = buildRowsFromTrace(trace, [a1, a2, r1, r2]);
    expect(rows.find((r) => r.agent_name === 'story-validator-agent')?.judge_score).toBe(0.87);
    expect(rows.find((r) => r.agent_name === 'po-agent')?.judge_score).toBeNull();
  });

  // 4
  it('4. captures prompt + actual_output', () => {
    const trace: LangfuseTrace = { id: 't-4' };
    const agent = fakeAgentSpan({ id: 'a-4', trace: 't-4', name: 'po-agent', role: 'po-decomposer' });
    const router = fakeRouterSpan({
      id: 'r-4', trace: 't-4', parent: 'a-4',
      taskType: 'po-decomposer-story', model: 'qwen3:14b',
      prompt: 'Decompose this story', output: 'story1, story2, story3',
    });
    const rows = buildRowsFromTrace(trace, [agent, router]);
    expect(rows[0]?.prompt).toBe('Decompose this story');
    expect(rows[0]?.actual_output).toBe('story1, story2, story3');
  });

  // 5
  it('5. captures agent.ok flag', () => {
    const trace: LangfuseTrace = { id: 't-5' };
    const a1 = fakeAgentSpan({ id: 'a-5a', trace: 't-5', name: 'po-agent', role: 'po-decomposer', ok: true });
    const a2 = fakeAgentSpan({ id: 'a-5b', trace: 't-5', name: 'ba-agent', role: 'ba-enricher', ok: false });
    const r1 = fakeRouterSpan({ id: 'r-5a', trace: 't-5', parent: 'a-5a', taskType: 'x', model: 'claude-sonnet-4-6' });
    const r2 = fakeRouterSpan({ id: 'r-5b', trace: 't-5', parent: 'a-5b', taskType: 'y', model: 'claude-sonnet-4-6' });
    const rows = buildRowsFromTrace(trace, [a1, a2, r1, r2]);
    expect(rows.find((r) => r.agent_name === 'po-agent')?.ok).toBe(true);
    expect(rows.find((r) => r.agent_name === 'ba-agent')?.ok).toBe(false);
  });

  // 6
  it('6. emits a row even when no router span is nested under the agent', () => {
    const trace: LangfuseTrace = { id: 't-6' };
    const agent = fakeAgentSpan({ id: 'a-6', trace: 't-6', name: 'po-agent', role: 'po-decomposer' });
    const rows = buildRowsFromTrace(trace, [agent]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe('unknown');
    expect(rows[0]?.tokens.total_tokens).toBe(0);
  });
});

describe('export-traces-for-dspy — formatting + paths', () => {
  // 7
  it('7. rowsToJsonl emits one JSON object per line + trailing newline', () => {
    const rows: DspyExportRow[] = [
      {
        trace_id: 't', agent_name: 'a', agent_role: 'r', task_type: 'x',
        model: 'm', prompt: 'p', expected_output: null, actual_output: 'o',
        judge_score: null, tokens: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        ok: true, duration_ms: 4, timestamp: '2026-05-01T00:00:00Z',
      },
    ];
    const out = rowsToJsonl(rows);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.split('\n').filter((l) => l).length).toBe(1);
    const parsed = JSON.parse(out.trim());
    expect(parsed.trace_id).toBe('t');
    expect(parsed.tokens.total_tokens).toBe(3);
  });

  // 8
  it('8. exportPathFor uses ~/.caia/traces/YYYY-MM-DD.jsonl', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'caia-traces-'));
    const path = exportPathFor(new Date('2026-04-30T15:00:00Z'), tmp);
    expect(path).toMatch(/2026-04-30\.jsonl$/);
    expect(path.startsWith(tmp)).toBe(true);
  });
});

describe('export-traces-for-dspy — fetchAndWriteRows', () => {
  // BONUS coverage (still part of the 8: this fans out the fetch test).
  it('end-to-end fetch + write — uses injected fetch + writes JSONL on disk', async () => {
    const trace: LangfuseTrace = { id: 't-9', timestamp: '2026-05-01T10:00:00Z' };
    const agent = fakeAgentSpan({ id: 'a-9', trace: 't-9', name: 'po-agent', role: 'po-decomposer', judge: 0.91 });
    const router = fakeRouterSpan({ id: 'r-9', trace: 't-9', parent: 'a-9', taskType: 'po-decomposer-story', model: 'claude-sonnet-4-6' });

    const fakeFetch: typeof fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('/api/public/traces')) {
        return new Response(JSON.stringify({ data: [trace] }), { status: 200 });
      }
      if (u.includes('/api/public/observations')) {
        return new Response(JSON.stringify({ data: [agent, router] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const tmp = mkdtempSync(join(tmpdir(), 'caia-traces-out-'));
    const out = join(tmp, 'today.jsonl');
    const { rowsWritten, path } = await fetchAndWriteRows(
      {
        host: 'http://fake',
        publicKey: 'pk',
        secretKey: 'sk',
        fromIso: '2026-05-01T00:00:00Z',
        toIso: '2026-05-01T23:59:59Z',
        fetchImpl: fakeFetch,
      },
      out,
    );
    expect(rowsWritten).toBe(1);
    expect(path).toBe(out);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, 'utf8').trim());
    expect(parsed.trace_id).toBe('t-9');
    expect(parsed.judge_score).toBe(0.91);
  });
});
