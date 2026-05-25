import { describe, expect, it } from 'vitest';

import { ALL_STATES, HAPPY_STATES, isTerminal } from '../src/states.js';
import {
  allEdges,
  availableTransitions,
  canTransition,
  checkTransition,
  reachableTerminals,
  validNextStates,
  VALID_TRANSITIONS,
} from '../src/transitions.js';

describe('transitions', () => {
  it('every state has an entry in VALID_TRANSITIONS', () => {
    for (const s of ALL_STATES) {
      expect(VALID_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('terminal states have zero outgoing transitions', () => {
    expect(VALID_TRANSITIONS.done).toEqual([]);
    expect(VALID_TRANSITIONS.archived).toEqual([]);
  });

  it('canTransition agrees with the table', () => {
    expect(canTransition('onboarding', 'idea-captured')).toBe(true);
    expect(canTransition('onboarding', 'done')).toBe(false);
  });

  it('canTransition rejects self-transitions', () => {
    expect(canTransition('onboarding', 'onboarding')).toBe(false);
  });

  it('canTransition rejects exits from terminal states', () => {
    expect(canTransition('done', 'archived')).toBe(false);
    expect(canTransition('archived', 'done')).toBe(false);
  });

  it('checkTransition explains self-transitions', () => {
    const r = checkTransition('onboarding', 'onboarding');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('self-transition');
  });

  it('checkTransition explains terminal exits', () => {
    const r = checkTransition('done', 'archived');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('terminal');
  });

  it('checkTransition explains missing edges', () => {
    const r = checkTransition('onboarding', 'deployed');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('not in the transition table');
  });

  it('validNextStates is an alias for availableTransitions', () => {
    for (const s of ALL_STATES) {
      expect(validNextStates(s)).toEqual(availableTransitions(s));
    }
  });

  it('every happy state can transition to archived', () => {
    for (const s of HAPPY_STATES) {
      if (isTerminal(s)) continue;
      expect(availableTransitions(s)).toContain('archived');
    }
  });

  it('every happy doing-state can transition to paused', () => {
    // Only `verified` is a happy-edge case: it goes to done/archived only.
    for (const s of HAPPY_STATES) {
      if (isTerminal(s)) continue;
      if (s === 'verified') continue;
      expect(availableTransitions(s)).toContain('paused');
    }
  });

  it('every failed state can transition to archived', () => {
    for (const s of ALL_STATES.filter((x) => x.endsWith('-failed'))) {
      expect(availableTransitions(s)).toContain('archived');
    }
  });

  it('happy path is contiguous', () => {
    for (let i = 0; i < HAPPY_STATES.length - 1; i++) {
      const from = HAPPY_STATES[i]!;
      const to = HAPPY_STATES[i + 1]!;
      // Some adjacencies aren't direct (e.g. atlas-ready -> change-requested
      // is via a special path), but the spec says canonical happy-path uses
      // the next state in the list except for change-requested.
      if (from === 'atlas-ready' && to === 'change-requested') continue;
      if (from === 'change-requested' && to === 'ea-dispatching') continue;
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('allEdges enumerates every (from,to)', () => {
    const edges = allEdges();
    let total = 0;
    for (const s of ALL_STATES) total += VALID_TRANSITIONS[s].length;
    expect(edges.length).toBe(total);
  });

  it('reachableTerminals from done returns [done]', () => {
    expect(reachableTerminals('done')).toEqual(['done']);
  });

  it('reachableTerminals from archived returns [archived]', () => {
    expect(reachableTerminals('archived')).toEqual(['archived']);
  });

  it('reachableTerminals from onboarding includes done and archived', () => {
    const r = reachableTerminals('onboarding');
    expect(r).toContain('done');
    expect(r).toContain('archived');
  });

  it('paused can resume into any non-paused state', () => {
    const exits = VALID_TRANSITIONS.paused;
    expect(exits).not.toContain('paused');
    expect(exits.length).toBe(ALL_STATES.length - 1);
  });
});

// -- ADR-024 (2026-05-25): Information Architect FSM edges -----------------
describe('transitions — Information Architect (ADR-024)', () => {
  it('interview-complete → information-architecture-in-progress is canonical', () => {
    expect(
      canTransition('interview-complete', 'information-architecture-in-progress'),
    ).toBe(true);
  });

  it('interview-complete no longer reaches proposal-generated directly', () => {
    expect(canTransition('interview-complete', 'proposal-generated')).toBe(false);
  });

  it('interview-complete can fast-fail to information-architecture-failed', () => {
    expect(
      canTransition('interview-complete', 'information-architecture-failed'),
    ).toBe(true);
  });

  it('IA-in-progress → IA-complete is the success edge', () => {
    expect(
      canTransition(
        'information-architecture-in-progress',
        'information-architecture-complete',
      ),
    ).toBe(true);
  });

  it('IA-in-progress → IA-failed is the failure edge', () => {
    expect(
      canTransition(
        'information-architecture-in-progress',
        'information-architecture-failed',
      ),
    ).toBe(true);
  });

  it('IA-in-progress can be paused and archived', () => {
    expect(
      canTransition('information-architecture-in-progress', 'paused'),
    ).toBe(true);
    expect(
      canTransition('information-architecture-in-progress', 'archived'),
    ).toBe(true);
  });

  it('IA-complete → proposal-generated replaces the legacy direct edge', () => {
    expect(
      canTransition('information-architecture-complete', 'proposal-generated'),
    ).toBe(true);
  });

  it('IA-complete can regenerate back into IA-in-progress (IA spec §6.3)', () => {
    expect(
      canTransition(
        'information-architecture-complete',
        'information-architecture-in-progress',
      ),
    ).toBe(true);
  });

  it('IA-complete → proposal-failed is a recognised failure path', () => {
    expect(
      canTransition('information-architecture-complete', 'proposal-failed'),
    ).toBe(true);
  });

  it('IA-failed recovers to interview-complete', () => {
    expect(
      canTransition(
        'information-architecture-failed',
        'interview-complete',
      ),
    ).toBe(true);
  });

  it('IA-failed recovers to IA-in-progress (resume from critic checkpoint)', () => {
    expect(
      canTransition(
        'information-architecture-failed',
        'information-architecture-in-progress',
      ),
    ).toBe(true);
  });

  it('IA-failed can only escape to interview-complete, IA-in-progress, or archived', () => {
    const exits = VALID_TRANSITIONS['information-architecture-failed'];
    expect([...exits].sort()).toEqual(
      [
        'archived',
        'information-architecture-in-progress',
        'interview-complete',
      ].sort(),
    );
  });

  it('proposal-failed can recover to IA-complete (re-render Step 4) or interview-complete (re-IA)', () => {
    expect(
      canTransition('proposal-failed', 'information-architecture-complete'),
    ).toBe(true);
    expect(canTransition('proposal-failed', 'interview-complete')).toBe(true);
  });

  it('change-requested can route back into IA-in-progress', () => {
    expect(
      canTransition('change-requested', 'information-architecture-in-progress'),
    ).toBe(true);
  });

  it('revision-pending can resume into IA-in-progress', () => {
    expect(
      canTransition('revision-pending', 'information-architecture-in-progress'),
    ).toBe(true);
  });

  it('done is still reachable from IA-in-progress', () => {
    expect(reachableTerminals('information-architecture-in-progress')).toContain(
      'done',
    );
  });

  it('done is still reachable from IA-complete', () => {
    expect(reachableTerminals('information-architecture-complete')).toContain(
      'done',
    );
  });

  it('done is still reachable from IA-failed (via recovery)', () => {
    expect(reachableTerminals('information-architecture-failed')).toContain(
      'done',
    );
  });

  it('IA-complete cannot skip Step 4 and jump straight to design-uploaded', () => {
    expect(
      canTransition('information-architecture-complete', 'design-uploaded'),
    ).toBe(false);
  });

  it('IA-in-progress cannot jump straight to proposal-generated', () => {
    expect(
      canTransition(
        'information-architecture-in-progress',
        'proposal-generated',
      ),
    ).toBe(false);
  });
});
