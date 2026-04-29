import { describe, it, expect, beforeEach } from 'vitest';
import {
  LlmMetricsTracker,
  perCallCostFromRuleString,
} from '../src/llm-metrics.js';

let tracker: LlmMetricsTracker;

beforeEach(() => {
  tracker = new LlmMetricsTracker();
});

describe('LlmMetricsTracker', () => {
  it('starts empty', () => {
    const snap = tracker.snapshot();
    expect(snap.totalCalls).toBe(0);
    expect(snap.localShare).toBe(0);
    expect(snap.savedUsd).toBe(0);
    expect(snap.perTask).toEqual([]);
  });

  it('records a local call as pure savings vs the Claude baseline', () => {
    tracker.record({
      taskType: 'domain-classification',
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      durationMs: 200,
      promptTokens: 12,
      completionTokens: 1,
      estimatedCostUsd: 0,
      baselineCostUsd: 0.00005,
      timestamp: 1_000,
    });
    const snap = tracker.snapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.localCalls).toBe(1);
    expect(snap.claudeCalls).toBe(0);
    expect(snap.localShare).toBe(1);
    expect(snap.savedUsd).toBeGreaterThan(0);
  });

  it('records a Claude call with zero savings', () => {
    tracker.record({
      taskType: 'architecture-decision',
      provider: 'claude',
      model: 'claude-opus-4-6',
      durationMs: 800,
      estimatedCostUsd: 0.003,
      baselineCostUsd: 0.003,
      timestamp: 1_000,
    });
    const snap = tracker.snapshot();
    expect(snap.localShare).toBe(0);
    expect(snap.savedUsd).toBe(0);
  });

  it('aggregates per task type', () => {
    for (let i = 0; i < 3; i++) {
      tracker.record({
        taskType: 'domain-classification',
        provider: 'local',
        model: 'qwen2.5-coder:7b',
        durationMs: 200,
        estimatedCostUsd: 0,
        baselineCostUsd: 0.00005,
        timestamp: 1_000 + i,
      });
    }
    tracker.record({
      taskType: 'architecture-decision',
      provider: 'claude',
      model: 'claude-opus-4-6',
      durationMs: 1000,
      estimatedCostUsd: 0.003,
      baselineCostUsd: 0.003,
      timestamp: 2_000,
    });

    const snap = tracker.snapshot();
    expect(snap.totalCalls).toBe(4);
    expect(snap.localShare).toBeCloseTo(0.75, 4);

    const byTask = new Map(snap.perTask.map((t) => [t.taskType, t]));
    expect(byTask.get('domain-classification')?.calls).toBe(3);
    expect(byTask.get('domain-classification')?.localShare).toBe(1);
    expect(byTask.get('architecture-decision')?.localShare).toBe(0);
  });

  it('orders perTask by call count, descending', () => {
    tracker.record({
      taskType: 'rare',
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      durationMs: 200,
      estimatedCostUsd: 0,
      baselineCostUsd: 0.0005,
      timestamp: 1,
    });
    for (let i = 0; i < 5; i++) {
      tracker.record({
        taskType: 'frequent',
        provider: 'local',
        model: 'qwen2.5-coder:7b',
        durationMs: 200,
        estimatedCostUsd: 0,
        baselineCostUsd: 0.0005,
        timestamp: 2 + i,
      });
    }
    const snap = tracker.snapshot();
    expect(snap.perTask[0]!.taskType).toBe('frequent');
    expect(snap.perTask[1]!.taskType).toBe('rare');
  });

  it('counts cache hits separately from miss-triggered calls', () => {
    tracker.record({
      taskType: 'domain-classification',
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      durationMs: 5,
      estimatedCostUsd: 0,
      baselineCostUsd: 0.00005,
      cacheHitKind: 'exact',
      timestamp: 1,
    });
    tracker.record({
      taskType: 'domain-classification',
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      durationMs: 200,
      estimatedCostUsd: 0,
      baselineCostUsd: 0.00005,
      timestamp: 2,
    });

    const snap = tracker.snapshot();
    expect(snap.cacheHits).toBe(1);
    expect(snap.cacheHitRate).toBe(0.5);
  });

  it('average duration is the mean across all recorded calls', () => {
    tracker.record({
      taskType: 't',
      provider: 'local',
      model: 'm',
      durationMs: 100,
      estimatedCostUsd: 0,
      baselineCostUsd: 0,
      timestamp: 1,
    });
    tracker.record({
      taskType: 't',
      provider: 'local',
      model: 'm',
      durationMs: 300,
      estimatedCostUsd: 0,
      baselineCostUsd: 0,
      timestamp: 2,
    });
    expect(tracker.snapshot().avgDurationMs).toBe(200);
  });

  it('reset clears every counter', () => {
    tracker.record({
      taskType: 't',
      provider: 'local',
      model: 'm',
      durationMs: 100,
      estimatedCostUsd: 0,
      baselineCostUsd: 0,
      timestamp: 1,
    });
    tracker.reset();
    const snap = tracker.snapshot();
    expect(snap.totalCalls).toBe(0);
    expect(snap.perTask).toEqual([]);
  });
});

describe('perCallCostFromRuleString', () => {
  it('parses dollar strings as per-1000-call rates', () => {
    expect(perCallCostFromRuleString('$0.05')).toBeCloseTo(0.00005, 8);
    expect(perCallCostFromRuleString('$1.00')).toBeCloseTo(0.001, 8);
    expect(perCallCostFromRuleString('$3.00')).toBeCloseTo(0.003, 8);
  });

  it('returns 0 for unparseable inputs', () => {
    expect(perCallCostFromRuleString('—')).toBe(0);
    expect(perCallCostFromRuleString('')).toBe(0);
  });

  it('strips currency symbol and whitespace', () => {
    expect(perCallCostFromRuleString(' $ 0.40 ')).toBeCloseTo(0.0004, 8);
  });
});
