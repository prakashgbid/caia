/**
 * Unit tests for the 8 A.10.4 event schemas. Each schema gets:
 *   - one round-trip parse test (valid → parsed equals input on required fields)
 *   - one reject-invalid test (missing required field or out-of-enum value)
 *
 * Coverage check at the bottom: every A.10.4 type appears in the registry
 * AND in EVENT_TYPES (so adding the 9th schema next quarter can't drift).
 */

import { describe, it, expect } from 'vitest';
import { validatePayload, EVENT_SCHEMAS } from '../src/schemas';
import { EVENT_TYPES, type EventType } from '../src/types';

const A104_TYPES: EventType[] = [
  'RouterDecision',
  'Compression',
  'ClaudeRequest',
  'ClaudeResponse',
  'ClaudeDuration',
  'ChainPhase',
  'SpawnerOutcome',
  'PromptOptimizerStage'
];

// ─── RouterDecision ───────────────────────────────────────────────────────

describe('RouterDecision', () => {
  it('round-trips a fully-populated payload', () => {
    const payload = {
      decisionId: 'rd-001',
      modelChosen: 'qwen2.5-coder:7b',
      provider: 'ollama' as const,
      displacementClass: 'local' as const,
      latencyMs: 12.5,
      caiaTaskType: 'routing-classify',
      reason: 'high-confidence-local',
      estimatedCostUsd: 0,
      baselineCostUsd: 0.0042
    };
    const result = validatePayload('RouterDecision', payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(payload);
    }
  });

  it('accepts the minimum required fields', () => {
    const result = validatePayload('RouterDecision', {
      decisionId: 'rd-002',
      modelChosen: 'claude-opus-4-7',
      provider: 'claude',
      displacementClass: 'claude',
      latencyMs: 0
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown displacementClass', () => {
    const result = validatePayload('RouterDecision', {
      decisionId: 'rd-003',
      modelChosen: 'claude-opus-4-7',
      provider: 'claude',
      displacementClass: 'mystery-tier',
      latencyMs: 100
    });
    expect(result.ok).toBe(false);
  });

  it('rejects negative latency', () => {
    const result = validatePayload('RouterDecision', {
      decisionId: 'rd-004',
      modelChosen: 'qwen2.5-coder:7b',
      provider: 'ollama',
      displacementClass: 'local',
      latencyMs: -1
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Compression ──────────────────────────────────────────────────────────

describe('Compression', () => {
  it('round-trips a typical shrink', () => {
    const payload = {
      stage: 'router.output',
      inputChars: 4096,
      outputChars: 1024,
      ratio: 0.25,
      method: 'summarize' as const,
      durationMs: 7,
      modelUsed: 'qwen2.5-coder:7b'
    };
    const result = validatePayload('Compression', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(payload);
  });

  it('rejects an unknown method', () => {
    const result = validatePayload('Compression', {
      stage: 'router.output',
      inputChars: 100,
      outputChars: 50,
      ratio: 0.5,
      method: 'magic-pixie-dust'
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing required field (ratio)', () => {
    const result = validatePayload('Compression', {
      stage: 'router.output',
      inputChars: 100,
      outputChars: 50,
      method: 'passthrough'
    });
    expect(result.ok).toBe(false);
  });
});

// ─── ClaudeRequest ────────────────────────────────────────────────────────

describe('ClaudeRequest', () => {
  it('round-trips with caching + thinking flags', () => {
    const payload = {
      requestId: 'cr-001',
      model: 'claude-opus-4-7',
      systemPromptHash: 'a1b2c3d4e5f60718',
      messageCount: 3,
      estimatedInputTokens: 4096,
      maxTokens: 8192,
      cachingEnabled: true,
      thinkingEnabled: false,
      caller: 'router'
    };
    const result = validatePayload('ClaudeRequest', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(payload);
  });

  it('rejects a malformed systemPromptHash', () => {
    const result = validatePayload('ClaudeRequest', {
      requestId: 'cr-002',
      model: 'claude-opus-4-7',
      systemPromptHash: 'NOT_HEX!',
      messageCount: 1
    });
    expect(result.ok).toBe(false);
  });
});

// ─── ClaudeResponse ───────────────────────────────────────────────────────

describe('ClaudeResponse', () => {
  it('round-trips a successful response', () => {
    const payload = {
      requestId: 'cr-001',
      tokenCount: 5432,
      inputTokens: 4000,
      outputTokens: 1000,
      cacheReadInputTokens: 432,
      cacheCreationInputTokens: 0,
      finishReason: 'end_turn' as const,
      httpStatus: 200
    };
    const result = validatePayload('ClaudeResponse', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(payload);
  });

  it('accepts an error response with errorCode', () => {
    const result = validatePayload('ClaudeResponse', {
      requestId: 'cr-002',
      tokenCount: 0,
      finishReason: 'error',
      errorCode: 'rate_limited',
      httpStatus: 429
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an out-of-range httpStatus', () => {
    const result = validatePayload('ClaudeResponse', {
      requestId: 'cr-003',
      tokenCount: 0,
      finishReason: 'end_turn',
      httpStatus: 42
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown finishReason', () => {
    const result = validatePayload('ClaudeResponse', {
      requestId: 'cr-004',
      tokenCount: 0,
      finishReason: 'aborted-by-vibes'
    });
    expect(result.ok).toBe(false);
  });
});

// ─── ClaudeDuration ───────────────────────────────────────────────────────

describe('ClaudeDuration', () => {
  it('round-trips a paired duration', () => {
    const payload = {
      requestId: 'cr-001',
      startTs: '2026-05-14T23:10:00.000Z',
      endTs: '2026-05-14T23:10:02.500Z',
      wallMs: 2500,
      ok: true
    };
    const result = validatePayload('ClaudeDuration', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(payload);
  });

  it('rejects a non-iso startTs', () => {
    const result = validatePayload('ClaudeDuration', {
      requestId: 'cr-002',
      startTs: 'yesterday',
      endTs: '2026-05-14T23:10:02.500Z',
      wallMs: 2500,
      ok: false
    });
    expect(result.ok).toBe(false);
  });
});

// ─── ChainPhase ───────────────────────────────────────────────────────────

describe('ChainPhase', () => {
  it('round-trips a typical transition', () => {
    const payload = {
      chainId: 'apprentice-pull-forward',
      phaseId: 3,
      status: 'in_progress' as const,
      sessionId: 'phase3-20260514T231008-95682',
      attempt: 1
    };
    const result = validatePayload('ChainPhase', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(payload);
  });

  it('accepts terminal status with duration + failureClass', () => {
    const result = validatePayload('ChainPhase', {
      chainId: 'chain-runner-battle-harden',
      phaseId: 11,
      status: 'failed',
      attempt: 2,
      durationMs: 600_000,
      failureClass: 'timeout',
      reason: 'phase exceeded max_minutes'
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = validatePayload('ChainPhase', {
      chainId: 'x',
      phaseId: 1,
      status: 'kinda-running'
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a negative phaseId', () => {
    const result = validatePayload('ChainPhase', {
      chainId: 'x',
      phaseId: -1,
      status: 'pending'
    });
    expect(result.ok).toBe(false);
  });
});

// ─── SpawnerOutcome ───────────────────────────────────────────────────────

describe('SpawnerOutcome', () => {
  it('round-trips a pr-merged outcome', () => {
    const payload = {
      host: 'm3-prakash',
      taskId: 'spawn-001',
      outcome: 'pr-merged' as const,
      durationMs: 123_456,
      exitCode: 0,
      worktreePath: '/tmp/spawn-001',
      prNumber: 449
    };
    const result = validatePayload('SpawnerOutcome', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(payload);
  });

  it('rejects an unknown outcome', () => {
    const result = validatePayload('SpawnerOutcome', {
      host: 'm3-prakash',
      taskId: 'spawn-002',
      outcome: 'half-completed',
      durationMs: 1000
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-positive prNumber', () => {
    const result = validatePayload('SpawnerOutcome', {
      host: 'm3-prakash',
      taskId: 'spawn-003',
      outcome: 'pr-opened',
      durationMs: 1000,
      prNumber: 0
    });
    expect(result.ok).toBe(false);
  });
});

// ─── PromptOptimizerStage ─────────────────────────────────────────────────

describe('PromptOptimizerStage', () => {
  it('round-trips a typical stage', () => {
    const payload = {
      runId: 'opt-001',
      stageNumber: 2,
      transform: 'claude-md-merge',
      tokensIn: 12_000,
      tokensOut: 8_400,
      durationMs: 45,
      noop: false
    };
    const result = validatePayload('PromptOptimizerStage', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(payload);
  });

  it('accepts a no-op stage', () => {
    const result = validatePayload('PromptOptimizerStage', {
      runId: 'opt-002',
      stageNumber: 4,
      transform: 'dedupe',
      tokensIn: 1024,
      tokensOut: 1024,
      noop: true
    });
    expect(result.ok).toBe(true);
  });

  it('rejects stageNumber = 0', () => {
    const result = validatePayload('PromptOptimizerStage', {
      runId: 'opt-003',
      stageNumber: 0,
      transform: 'dedupe',
      tokensIn: 100,
      tokensOut: 100
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty transform', () => {
    const result = validatePayload('PromptOptimizerStage', {
      runId: 'opt-004',
      stageNumber: 1,
      transform: '',
      tokensIn: 100,
      tokensOut: 90
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Coverage guard ───────────────────────────────────────────────────────

describe('A.10.4 coverage', () => {
  it('every A.10.4 type appears in EVENT_TYPES', () => {
    for (const t of A104_TYPES) {
      expect(EVENT_TYPES).toContain(t);
    }
  });

  it('every A.10.4 type has a registered Zod schema', () => {
    for (const t of A104_TYPES) {
      expect(EVENT_SCHEMAS[t]).toBeDefined();
    }
  });

  it('EVENT_TYPES has exactly the 22 base + 8 A.10.4 = 30 entries', () => {
    expect(EVENT_TYPES.length).toBe(30);
  });
});
