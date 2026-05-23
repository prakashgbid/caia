/**
 * Cross-architect invariants — verifies Observability's contributions
 * to the EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import { OBSERVABILITY_INVARIANTS } from '../src/invariants.js';
import { composedArchitectureForInvariants, goldenExpectedOutput } from './helpers/fakes.js';

describe('OBSERVABILITY_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(OBSERVABILITY_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of OBSERVABILITY_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `observability`', () => {
    for (const inv of OBSERVABILITY_INVARIANTS) {
      expect(inv.contributor).toBe('observability');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of OBSERVABILITY_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of OBSERVABILITY_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of OBSERVABILITY_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('OBSERVABILITY_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of OBSERVABILITY_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('metrics-nonempty fails on an empty metrics list', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(i => i.id === 'observability.metrics-nonempty');
    expect(inv).toBeDefined();
    const empty = { ...goldenArch, 'observability.metricsEmitted': [] };
    expect(inv!.detect(empty)).toBe(false);
  });

  it('metric-names-prometheus-compatible fails on an illegal name', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(
      i => i.id === 'observability.metric-names-prometheus-compatible'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.metricsEmitted': [
        { name: 'HttpRequests', type: 'counter', labels: [] }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('metric-names-prometheus-compatible accepts a snake_case + unit suffix name', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(
      i => i.id === 'observability.metric-names-prometheus-compatible'
    );
    expect(inv).toBeDefined();
    const ok = {
      ...goldenArch,
      'observability.metricsEmitted': [
        { name: 'queue_depth_total', type: 'gauge', labels: [] }
      ]
    };
    expect(inv!.detect(ok)).toBe(true);
  });

  it('every-sli-has-slo fails when an SLI has no matching SLO entry', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(i => i.id === 'observability.every-sli-has-slo');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.slis': {
        availability: { reads: ['http_requests_total'], formula: 'x' },
        orphan_sli: { reads: ['http_requests_total'], formula: 'y' }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('alerts-have-runbooks fails when an alerting rule cites an unknown runbook', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(i => i.id === 'observability.alerts-have-runbooks');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.alertingRules': [
        {
          id: 'missing-runbook',
          sli: 'availability',
          threshold: '<0.99',
          window: '5m',
          severity: 'P0',
          runbookRef: 'rb-does-not-exist'
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('alert-severities-from-ladder fails on an invalid severity', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(
      i => i.id === 'observability.alert-severities-from-ladder'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.alertingRules': [
        {
          id: 'x',
          sli: 'availability',
          threshold: '<0.99',
          window: '5m',
          severity: 'P9',
          runbookRef: 'rb-contacts-availability'
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('logging-strategy-is-structured-json fails on plaintext logger', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(
      i => i.id === 'observability.logging-strategy-is-structured-json'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.loggingStrategy': { format: 'text' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('error-tracking-provider-is-allowlisted fails on an invented provider', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(
      i => i.id === 'observability.error-tracking-provider-is-allowlisted'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.errorTrackingProvider': { provider: 'splunk' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('error-tracking-provider-is-allowlisted accepts "none" for offline tenants', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(
      i => i.id === 'observability.error-tracking-provider-is-allowlisted'
    );
    expect(inv).toBeDefined();
    const ok = {
      ...goldenArch,
      'observability.errorTrackingProvider': { provider: 'none' }
    };
    expect(inv!.detect(ok)).toBe(true);
  });

  it('tracing-is-opentelemetry fails on a non-OTel system', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(i => i.id === 'observability.tracing-is-opentelemetry');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.tracingStrategy': { system: 'zipkin' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('slis-reference-emitted-metrics flags an SLI referencing an unknown metric (advisory)', () => {
    const inv = OBSERVABILITY_INVARIANTS.find(
      i => i.id === 'observability.slis-reference-emitted-metrics'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'observability.slis': {
        custom: { reads: ['nonexistent_metric_total'], formula: 'x' }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('invariants work against a composed (Backend+Observability) architecture view', () => {
    const composed = composedArchitectureForInvariants();
    for (const inv of OBSERVABILITY_INVARIANTS) {
      const ok = inv.detect(composed);
      expect(ok, `invariant ${inv.id} should pass on composed view`).toBe(true);
    }
  });
});
