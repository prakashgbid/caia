import { describe, expect, it } from 'vitest';
import { ProcessSchema, validateProcessGraph, type Process } from '../src/process-graph.js';

const baseValid: Process = {
  id: 'post-release-back-merge',
  name: 'Post-release back-merge into develop',
  version: 1,
  description: 'Test',
  repos: ['caia'],
  enabled: true,
  recovery_capability_tokens: ['gh.pr.create'],
  signals: ['github.pull_request.merged'],
  invariants: [
    {
      id: 'detect_release_landed',
      when: 'event.type == "github.pull_request.merged"',
      emit: 'release_landed',
    },
    {
      id: 'detect_back_merge_opened',
      when: 'event.type == "github.pull_request.opened"',
      emit: 'back_merge_opened',
    },
  ],
  transitions: [
    {
      from: 'release_landed',
      expected_next: 'back_merge_opened',
      deadline_min: 30,
      on_miss: {
        severity: 'medium',
        recovery_kind: 'open-back-merge-pr',
        recovery_payload: { foo: 'bar' },
      },
    },
  ],
};

describe('ProcessSchema', () => {
  it('accepts a valid process', () => {
    const parsed = ProcessSchema.parse(baseValid);
    expect(parsed.id).toBe('post-release-back-merge');
  });

  it('rejects non-kebab-case ids', () => {
    expect(() => ProcessSchema.parse({ ...baseValid, id: 'PostRelease' })).toThrow();
    expect(() => ProcessSchema.parse({ ...baseValid, id: 'post_release' })).toThrow();
  });

  it('rejects non-positive version', () => {
    expect(() => ProcessSchema.parse({ ...baseValid, version: 0 })).toThrow();
    expect(() => ProcessSchema.parse({ ...baseValid, version: -1 })).toThrow();
  });

  it('rejects empty signals array', () => {
    expect(() => ProcessSchema.parse({ ...baseValid, signals: [] })).toThrow();
  });

  it('defaults repos to ["*"] when omitted', () => {
    const { repos: _omit, ...rest } = baseValid;
    const parsed = ProcessSchema.parse(rest);
    expect(parsed.repos).toEqual(['*']);
  });

  it('defaults enabled to true when omitted', () => {
    const { enabled: _omit, ...rest } = baseValid;
    const parsed = ProcessSchema.parse(rest);
    expect(parsed.enabled).toBe(true);
  });

  it('defaults recovery_capability_tokens to [] when omitted', () => {
    const { recovery_capability_tokens: _omit, ...rest } = baseValid;
    const parsed = ProcessSchema.parse(rest);
    expect(parsed.recovery_capability_tokens).toEqual([]);
  });

  it('rejects unknown severity', () => {
    const broken = {
      ...baseValid,
      transitions: [
        {
          ...baseValid.transitions[0]!,
          on_miss: { ...baseValid.transitions[0]!.on_miss, severity: 'critical' },
        },
      ],
    };
    expect(() => ProcessSchema.parse(broken)).toThrow();
  });

  it('rejects unknown recovery_kind', () => {
    const broken = {
      ...baseValid,
      transitions: [
        {
          ...baseValid.transitions[0]!,
          on_miss: { ...baseValid.transitions[0]!.on_miss, recovery_kind: 'rm-rf' },
        },
      ],
    };
    expect(() => ProcessSchema.parse(broken)).toThrow();
  });

  it('rejects non-positive deadline_min', () => {
    const broken = {
      ...baseValid,
      transitions: [{ ...baseValid.transitions[0]!, deadline_min: 0 }],
    };
    expect(() => ProcessSchema.parse(broken)).toThrow();
  });

  it('rejects non-integer deadline_min', () => {
    const broken = {
      ...baseValid,
      transitions: [{ ...baseValid.transitions[0]!, deadline_min: 1.5 }],
    };
    expect(() => ProcessSchema.parse(broken)).toThrow();
  });
});

describe('validateProcessGraph', () => {
  it('passes when transition.from is emitted by an invariant', () => {
    expect(() => validateProcessGraph(baseValid)).not.toThrow();
  });

  it('passes when transition.from is in signals[]', () => {
    const directOnSignal: Process = {
      ...baseValid,
      invariants: [],
      transitions: [
        {
          ...baseValid.transitions[0]!,
          from: 'github.pull_request.merged',
          expected_next: 'back_merge_opened',
        },
      ],
    };
    // Note: this still doesn't have an emitter for `back_merge_opened`, but
    // the validator only checks `from`, not `expected_next`. That's intentional
    // — `expected_next` may be observed externally without an invariant.
    expect(() => validateProcessGraph(directOnSignal)).not.toThrow();
  });

  it('throws when transition.from is unreachable', () => {
    const orphan: Process = {
      ...baseValid,
      transitions: [
        {
          ...baseValid.transitions[0]!,
          from: 'never_emitted',
        },
      ],
    };
    expect(() => validateProcessGraph(orphan)).toThrow(/never_emitted/);
  });
});
