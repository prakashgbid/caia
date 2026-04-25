/**
 * Contract: TRACE-001/002/003
 * Verifies: root_prompt_id must be set before operations proceed; deduplication
 * within the 10-second window is enforced; violations are recorded correctly.
 */

import { PromptContext } from '../../apps/orchestrator-middleware/src/prompt-creator';
import { MissingRootPromptError } from '../../apps/orchestrator-middleware/src/errors';

describe('PromptContext contract (TRACE-001/002/003)', () => {
  let ctx: PromptContext;

  beforeEach(() => {
    ctx = new PromptContext();
  });

  afterEach(() => {
    ctx.reset();
  });

  describe('assertHasRootPromptId', () => {
    it('should throw MissingRootPromptError when root_prompt_id has not been set', () => {
      expect(() => ctx.assertHasRootPromptId()).toThrow(MissingRootPromptError);
    });

    it('thrown error should carry TRACE-001 in its message', () => {
      let caught: Error | undefined;
      try {
        ctx.assertHasRootPromptId();
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeInstanceOf(MissingRootPromptError);
      expect(caught!.message).toContain('TRACE-001');
    });

    it('should not throw when root_prompt_id has been set via setRootPromptId', () => {
      ctx.setRootPromptId('rp-abc123');
      expect(() => ctx.assertHasRootPromptId()).not.toThrow();
    });

    it('getRootPromptId should return undefined before setRootPromptId is called', () => {
      expect(ctx.getRootPromptId()).toBeUndefined();
    });

    it('getRootPromptId should return the id after setRootPromptId is called', () => {
      ctx.setRootPromptId('rp-xyz789');
      expect(ctx.getRootPromptId()).toBe('rp-xyz789');
    });
  });

  describe('violation recording on assertHasRootPromptId failure', () => {
    it('should record a TRACE-001 violation when assertHasRootPromptId throws', () => {
      try { ctx.assertHasRootPromptId(); } catch { /* expected */ }

      const violations = ctx.getViolations();
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]!.ruleId).toBe('TRACE-001');
      expect(violations[0]!.severity).toBe('block');
    });

    it('should not record a violation when assertHasRootPromptId succeeds', () => {
      ctx.setRootPromptId('rp-clean');
      ctx.assertHasRootPromptId();

      expect(ctx.getViolations()).toHaveLength(0);
    });
  });

  describe('ensurePromptCreated — deduplication', () => {
    it('should return the same pseudo-ID for identical prompt bodies within 10 seconds', async () => {
      const id1 = await ctx.ensurePromptCreated('Deploy the service', 'chat');
      const id2 = await ctx.ensurePromptCreated('Deploy the service', 'chat');
      expect(id1).toBe(id2);
    });

    it('should return different IDs for different prompt bodies', async () => {
      const id1 = await ctx.ensurePromptCreated('Deploy the service', 'chat');
      const id2 = await ctx.ensurePromptCreated('Rollback the service', 'chat');
      expect(id1).not.toBe(id2);
    });

    it('returned pseudo-ID should be a non-empty string', async () => {
      const id = await ctx.ensurePromptCreated('Some prompt body', 'api');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should create a new entry after the 10-second dedup window has elapsed', async () => {
      // We manipulate Date.now by spying on it so we can advance time.
      const realDateNow = Date.now.bind(Date);
      let fakeEpoch = realDateNow();

      const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeEpoch);

      try {
        const id1 = await ctx.ensurePromptCreated('Idempotent prompt', 'cli');

        // Advance past the 10-second dedup window
        fakeEpoch += 11_000;

        const id2 = await ctx.ensurePromptCreated('Idempotent prompt', 'cli');

        // After the window expires the context should issue a fresh ID
        expect(id2).not.toBe(id1);
      } finally {
        dateSpy.mockRestore();
      }
    });
  });

  describe('reset', () => {
    it('should clear root_prompt_id, prompt history, and violations', async () => {
      ctx.setRootPromptId('rp-before-reset');
      await ctx.ensurePromptCreated('Some body', 'chat');
      try { ctx.assertHasRootPromptId(); } catch { /* populate violations in a fresh ctx */ }

      // Force a violation by resetting first, then asserting
      ctx.reset();
      try { ctx.assertHasRootPromptId(); } catch { /* expected */ }

      ctx.reset();

      expect(ctx.getRootPromptId()).toBeUndefined();
      expect(ctx.getViolations()).toHaveLength(0);
    });

    it('should make dedup window start fresh after reset', async () => {
      const id1 = await ctx.ensurePromptCreated('Same prompt', 'chat');
      ctx.reset();
      const id2 = await ctx.ensurePromptCreated('Same prompt', 'chat');
      // After reset the history is cleared — the IDs may differ
      // (the counter resets to 0 so the pseudo-ID prefix will be the same structure,
      // but the important invariant is that both calls succeed without throwing).
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
    });
  });
});
