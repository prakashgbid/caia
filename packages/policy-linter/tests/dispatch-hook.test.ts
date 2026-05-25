import { describe, expect, it, vi } from 'vitest';
import { runPolicyPreflight } from '../src/dispatch-hook.js';
import type { Policy } from '../src/types.js';
import { makeCtx } from './fixtures.js';

function policy(id: string, ok: boolean, mode: 'hard-fail' | 'soft-fail' | 'advisory' = 'hard-fail'): Policy {
  return {
    id,
    description: id,
    defaultMode: mode,
    async check() {
      return ok
        ? { ok: true }
        : { ok: false, mode, reason: `${id} fired` };
    }
  };
}

describe('runPolicyPreflight', () => {
  it('proceeds when all policies pass', async () => {
    const dispatch = vi.fn().mockResolvedValue('dispatched-value');
    const out = await runPolicyPreflight({
      ctx: makeCtx(),
      dispatch,
      policies: [policy('a', true), policy('b', true)]
    });
    expect(out.proceeded).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(out.result).toBe('dispatched-value');
  });

  it('blocks when any policy hard-fails', async () => {
    const dispatch = vi.fn();
    const out = await runPolicyPreflight({
      ctx: makeCtx(),
      dispatch,
      policies: [policy('a', false, 'hard-fail')]
    });
    expect(out.proceeded).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(out.blockReason).toMatch(/hard-fail/);
  });

  it('proceeds on soft-fail by default', async () => {
    const dispatch = vi.fn().mockResolvedValue('ok');
    const out = await runPolicyPreflight({
      ctx: makeCtx(),
      dispatch,
      policies: [policy('a', false, 'soft-fail')]
    });
    expect(out.proceeded).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('blocks on soft-fail when onSoftFail=block', async () => {
    const dispatch = vi.fn();
    const out = await runPolicyPreflight({
      ctx: makeCtx(),
      dispatch,
      onSoftFail: 'block',
      policies: [policy('a', false, 'soft-fail')]
    });
    expect(out.proceeded).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns a markdown rendering on every call', async () => {
    const out = await runPolicyPreflight({
      ctx: makeCtx(),
      dispatch: () => Promise.resolve(),
      policies: [policy('a', true)]
    });
    expect(out.markdown).toMatch(/# Policy report/);
  });

  it('propagates dispatch errors', async () => {
    const err = new Error('dispatch boom');
    await expect(
      runPolicyPreflight({
        ctx: makeCtx(),
        dispatch: async () => {
          throw err;
        },
        policies: [policy('a', true)]
      })
    ).rejects.toBe(err);
  });
});
