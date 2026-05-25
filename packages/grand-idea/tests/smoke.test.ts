/** Smoke test — public surface imports cleanly + contract is stable. */
import { describe, expect, it } from 'vitest';
import * as Public from '../src/index.js';

describe('public surface', () => {
  it('exports the documented runtime + types', () => {
    const names = [
      'GRAND_IDEA_CONTRACT',
      'GRAND_IDEA_WORD_FLOOR',
      'GRAND_IDEA_WORD_CEILING',
      'GrandIdeaError',
      'GrandIdeaPersistence',
      'MemoryGrandIdeaPersistence',
      'StaticAccessVerifier',
      'RejectAccessVerifier',
      'createCaptureHandler',
      'advanceToIdeaCaptured',
      'captureRequestSchema',
      'computeWordCount',
      'tenantSchemaName',
      'isGrandIdeaError',
      'DEFAULT_MIGRATION_PATH',
    ];
    for (const name of names) {
      expect(name in Public).toBe(true);
    }
  });

  it('contract is frozen and declares the canonical FSM transition', () => {
    const c = Public.GRAND_IDEA_CONTRACT;
    expect(Object.isFrozen(c)).toBe(true);
    expect(c.agentId).toBe('@caia/grand-idea');
    expect(c.fsmTransitions).toContainEqual({
      from: 'onboarding',
      to: 'idea-captured',
      reason: 'grand-idea-captured',
    });
    expect(c.artifacts.writes).toContain('caia_<tenant>.grand_ideas');
  });
});
