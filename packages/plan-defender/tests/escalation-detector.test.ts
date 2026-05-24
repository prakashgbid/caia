import { describe, expect, it } from 'vitest';

import { makeStubContextDump } from '../src/context-dump.js';
import {
  detectEscalation,
  isConsecutiveLowConfidence,
  isProducerNeverDecided,
  isStrategicQuestion
} from '../src/escalation-detector.js';

describe('isStrategicQuestion', () => {
  it('flags pivot questions', () => {
    const r = isStrategicQuestion('should we pivot to a marketplace model?');
    expect(r.match).toBe(true);
  });

  it('flags billing-model questions', () => {
    const r = isStrategicQuestion('what about our pricing tier?');
    expect(r.match).toBe(true);
  });

  it('flags principle amendments', () => {
    const r = isStrategicQuestion('should we amend a principle?');
    expect(r.match).toBe(true);
  });

  it('returns false on normal technical questions', () => {
    const r = isStrategicQuestion('why did you pick xstate over a custom FSM?');
    expect(r.match).toBe(false);
  });
});

describe('isProducerNeverDecided', () => {
  it('returns true when no overlap exists', () => {
    const dump = makeStubContextDump();
    expect(isProducerNeverDecided('how should we authenticate websocket clients?', dump)).toBe(true);
  });

  it('returns false when an existing decision_point overlaps', () => {
    const dump = makeStubContextDump({
      decision_points: [
        {
          decision: 'websocket authentication',
          options_considered: ['JWT', 'session'],
          chosen: 'JWT',
          rationale: 'stateless',
          confidence: 'high',
          revisitable_if: 'never'
        }
      ]
    });
    expect(isProducerNeverDecided('how should we authenticate websocket clients?', dump)).toBe(false);
  });
});

describe('isConsecutiveLowConfidence', () => {
  it('returns true on three lows in a row', () => {
    const answers = [
      { confidence: 'low' as const, round: 1, answer: '', cited_sources: [], recommended_action: 'plan-stands' as const, ts: 't' },
      { confidence: 'low' as const, round: 2, answer: '', cited_sources: [], recommended_action: 'plan-stands' as const, ts: 't' },
      { confidence: 'low' as const, round: 3, answer: '', cited_sources: [], recommended_action: 'plan-stands' as const, ts: 't' }
    ];
    expect(isConsecutiveLowConfidence(answers, 3)).toBe(true);
  });

  it('returns false on broken streak', () => {
    const answers = [
      { confidence: 'low' as const, round: 1, answer: '', cited_sources: [], recommended_action: 'plan-stands' as const, ts: 't' },
      { confidence: 'high' as const, round: 2, answer: '', cited_sources: [], recommended_action: 'plan-stands' as const, ts: 't' },
      { confidence: 'low' as const, round: 3, answer: '', cited_sources: [], recommended_action: 'plan-stands' as const, ts: 't' }
    ];
    expect(isConsecutiveLowConfidence(answers, 3)).toBe(false);
  });
});

describe('detectEscalation precedence', () => {
  it('strategic beats producer-never-decided', () => {
    const result = detectEscalation({
      question: { round: 1, question: 'should we pivot?', ts: 't' },
      recentAnswers: [],
      dump: makeStubContextDump(),
      consecutiveThreshold: 3
    });
    expect(result?.kind).toBe('strategic-class-question');
  });
});
