/**
 * Golden test — the canonical known-good Observability-architect
 * artifact for a known prakash-tiwari contact-form Story ticket.
 *
 * Includes the SLI/SLO realism check required by the task brief step 3:
 *   - availability ≥ 99% and ≤ 99.99% (no 100%-uptime fantasy)
 *   - latency targets in sensible ms ranges
 *   - error_rate target < 5%
 *   - windows in {5m, 15m, 1h, 7d, 30d}
 *   - reads have stricter p95 than writes
 *   - every SLI has a matching SLO
 *   - every alert has a runbook reference
 *   - every runbook has an escalation owner + MTTR
 */

import { describe, it, expect } from 'vitest';

import { ObservabilityArchitect } from '../../src/architect.js';
import { OBSERVABILITY_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { OBSERVABILITY_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

describe('golden — prakash-tiwari contact-form Observability Story ticket', () => {
  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(goldenAssistantText(), OBSERVABILITY_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ObservabilityArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    expect(out.architectName).toBe('observability');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    for (const k of OBSERVABILITY_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every Observability invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ObservabilityArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of OBSERVABILITY_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ObservabilityArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });
});

describe('golden — realistic SLI/SLO sanity check (task brief step 3)', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('declares at least 3 SLIs (availability + latency + error_rate)', () => {
    const slis = goldenArch['observability.slis'] as Record<string, unknown>;
    expect(Object.keys(slis).length).toBeGreaterThanOrEqual(3);
    expect(slis).toHaveProperty('availability');
    expect(slis).toHaveProperty('latency_p95');
    expect(slis).toHaveProperty('error_rate');
  });

  it('every SLI references at least one Prometheus metric from metricsEmitted', () => {
    const slis = goldenArch['observability.slis'] as Record<string, { reads: string[] }>;
    const metrics = goldenArch['observability.metricsEmitted'] as Array<{ name: string }>;
    const metricNames = new Set(metrics.map(m => m.name));
    for (const [sliName, sli] of Object.entries(slis)) {
      expect(sli.reads.length).toBeGreaterThan(0);
      for (const r of sli.reads) {
        expect(metricNames.has(r), `SLI ${sliName} reads unknown metric ${r}`).toBe(true);
      }
    }
  });

  it('availability SLO target is realistic (between 99% and 99.99%)', () => {
    const slos = goldenArch['observability.slos'] as Array<{ sli: string; target: unknown }>;
    const availabilitySlo = slos.find(s => s.sli === 'availability');
    expect(availabilitySlo).toBeDefined();
    expect(typeof availabilitySlo!.target).toBe('number');
    const target = availabilitySlo!.target as number;
    expect(target).toBeGreaterThanOrEqual(0.99);
    expect(target).toBeLessThanOrEqual(0.9999);
  });

  it('latency SLO targets are in realistic ms ranges (≤ 5000ms p95)', () => {
    const slos = goldenArch['observability.slos'] as Array<{
      sli: string;
      target: string;
    }>;
    const latencySlos = slos.filter(s => s.sli.startsWith('latency'));
    expect(latencySlos.length).toBeGreaterThan(0);
    for (const s of latencySlos) {
      const m = /<\s*(\d+)\s*ms/.exec(s.target);
      expect(m).not.toBeNull();
      const ms = Number.parseInt(m![1], 10);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(5000);
    }
  });

  it('reads have stricter p95 budget than writes (reads < writes)', () => {
    const slos = goldenArch['observability.slos'] as Array<{
      sli: string;
      target: string;
      scope?: string;
    }>;
    const readBudget = slos.find(
      s => s.sli.startsWith('latency') && s.scope === 'reads'
    );
    const writeBudget = slos.find(
      s => s.sli.startsWith('latency') && s.scope === 'writes'
    );
    expect(readBudget).toBeDefined();
    expect(writeBudget).toBeDefined();
    const readMs = Number.parseInt(/<\s*(\d+)\s*ms/.exec(readBudget!.target)![1], 10);
    const writeMs = Number.parseInt(/<\s*(\d+)\s*ms/.exec(writeBudget!.target)![1], 10);
    expect(readMs).toBeLessThan(writeMs);
  });

  it('error_rate SLO target is realistic (< 5%)', () => {
    const slos = goldenArch['observability.slos'] as Array<{ sli: string; target: string }>;
    const errorSlo = slos.find(s => s.sli === 'error_rate');
    expect(errorSlo).toBeDefined();
    const m = /<\s*(0?\.\d+)/.exec(errorSlo!.target);
    expect(m).not.toBeNull();
    const rate = Number.parseFloat(m![1]);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(0.05);
  });

  it('every SLO window is in the canonical set {5m, 15m, 1h, 7d, 30d}', () => {
    const slos = goldenArch['observability.slos'] as Array<{ window: string }>;
    const allowed = new Set(['5m', '15m', '1h', '7d', '30d']);
    for (const s of slos) {
      expect(allowed.has(s.window), `unexpected SLO window: ${s.window}`).toBe(true);
    }
  });

  it('availability and error_rate have at least one P0 alert', () => {
    const rules = goldenArch['observability.alertingRules'] as Array<{
      sli: string;
      severity: string;
    }>;
    const hasP0Availability = rules.some(r => r.sli === 'availability' && r.severity === 'P0');
    const hasP0ErrorRate = rules.some(r => r.sli === 'error_rate' && r.severity === 'P0');
    expect(hasP0Availability).toBe(true);
    expect(hasP0ErrorRate).toBe(true);
  });

  it('every P0 alert pages within 5 minutes', () => {
    const rules = goldenArch['observability.alertingRules'] as Array<{
      severity: string;
      pageWithin?: string;
    }>;
    const p0s = rules.filter(r => r.severity === 'P0');
    expect(p0s.length).toBeGreaterThan(0);
    for (const r of p0s) {
      expect(r.pageWithin, 'P0 alert missing pageWithin field').toBeDefined();
      expect(r.pageWithin).toBe('5m');
    }
  });

  it('every alert rule has a runbook reference', () => {
    const rules = goldenArch['observability.alertingRules'] as Array<{ runbookRef: string }>;
    const runbooks = goldenArch['observability.runbookReferences'] as Record<string, unknown>;
    expect(Object.keys(runbooks).length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.runbookRef).toBeTruthy();
      expect(runbooks).toHaveProperty(r.runbookRef);
    }
  });

  it('every runbook has an escalation owner + expected MTTR', () => {
    const runbooks = goldenArch['observability.runbookReferences'] as Record<
      string,
      { escalationOwner?: string; expectedMttrMinutes?: number }
    >;
    for (const [id, rb] of Object.entries(runbooks)) {
      expect(rb.escalationOwner, `runbook ${id} missing escalationOwner`).toBeTruthy();
      expect(typeof rb.expectedMttrMinutes).toBe('number');
      expect(rb.expectedMttrMinutes!).toBeGreaterThan(0);
      expect(rb.expectedMttrMinutes!).toBeLessThanOrEqual(240);
    }
  });

  it('PII redaction is declared per endpoint with body data (email/message)', () => {
    const ls = goldenArch['observability.loggingStrategy'] as {
      perEndpoint: Record<string, { piiRedaction: string[] }>;
    };
    expect(ls.perEndpoint['POST /api/contacts'].piiRedaction).toContain('email');
    expect(ls.perEndpoint['POST /api/contacts'].piiRedaction).toContain('message');
  });

  it('tracing samples 100% on 5xx (tail) and 10% on success (head)', () => {
    const ts = goldenArch['observability.tracingStrategy'] as {
      sampling: { head: number; tail: { on5xx: number } };
    };
    expect(ts.sampling.head).toBeCloseTo(0.1, 5);
    expect(ts.sampling.tail.on5xx).toBeCloseTo(1.0, 5);
  });
});
