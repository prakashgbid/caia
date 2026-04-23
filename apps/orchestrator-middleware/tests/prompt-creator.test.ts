/**
 * Tests for the TRACE-001/002 enforcement — PromptContext.
 */

import { PromptContext } from '../src/prompt-creator.js';
import { MissingRootPromptError } from '../src/errors.js';

describe('PromptContext', () => {
  let ctx: PromptContext;

  beforeEach(() => {
    ctx = new PromptContext();
  });

  afterEach(() => {
    ctx.reset();
  });

  describe('ensurePromptCreated', () => {
    it('returns a non-empty pseudo-ID for a new prompt body', async () => {
      const id = await ctx.ensurePromptCreated('Build the feature', 'chat');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('returns the same ID for identical body within the dedup window', async () => {
      const body = 'Build the feature';
      const id1 = await ctx.ensurePromptCreated(body, 'chat');
      const id2 = await ctx.ensurePromptCreated(body, 'chat');
      expect(id1).toBe(id2);
    });

    it('returns different IDs for different prompt bodies', async () => {
      const id1 = await ctx.ensurePromptCreated('First prompt', 'chat');
      const id2 = await ctx.ensurePromptCreated('Second prompt', 'api');
      expect(id1).not.toBe(id2);
    });
  });

  describe('setRootPromptId / getRootPromptId', () => {
    it('returns undefined before setRootPromptId is called', () => {
      expect(ctx.getRootPromptId()).toBeUndefined();
    });

    it('returns the set value after setRootPromptId', () => {
      ctx.setRootPromptId('prompt-abc-123');
      expect(ctx.getRootPromptId()).toBe('prompt-abc-123');
    });
  });

  describe('assertHasRootPromptId', () => {
    it('does not throw when root_prompt_id is set', () => {
      ctx.setRootPromptId('prompt-xyz');
      expect(() => ctx.assertHasRootPromptId()).not.toThrow();
    });

    it('throws MissingRootPromptError when root_prompt_id is not set', () => {
      expect(() => ctx.assertHasRootPromptId()).toThrow(MissingRootPromptError);
    });

    it('records a TRACE-001 violation when it throws', () => {
      try { ctx.assertHasRootPromptId(); } catch { /* expected */ }
      const violations = ctx.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0]!.ruleId).toBe('TRACE-001');
      expect(violations[0]!.severity).toBe('block');
    });

    it('MissingRootPromptError carries context string', () => {
      let caught: MissingRootPromptError | undefined;
      try { ctx.assertHasRootPromptId(); } catch (e) { caught = e as MissingRootPromptError; }
      expect(caught).toBeDefined();
      expect(caught!.context.length).toBeGreaterThan(0);
      expect(caught!.name).toBe('MissingRootPromptError');
    });
  });

  describe('getViolations', () => {
    it('returns empty array when no violations occurred', () => {
      expect(ctx.getViolations()).toHaveLength(0);
    });

    it('returns a copy, not the internal array', () => {
      try { ctx.assertHasRootPromptId(); } catch { /* expected */ }
      const v1 = ctx.getViolations();
      const v2 = ctx.getViolations();
      expect(v1).not.toBe(v2);
      expect(v1).toEqual(v2);
    });
  });

  describe('reset', () => {
    it('clears rootPromptId and violations', async () => {
      await ctx.ensurePromptCreated('body', 'chat');
      ctx.setRootPromptId('prompt-1');
      try { ctx.assertHasRootPromptId(); } catch { /* noop */ }
      ctx.reset();
      expect(ctx.getRootPromptId()).toBeUndefined();
      expect(ctx.getViolations()).toHaveLength(0);
    });
  });
});
