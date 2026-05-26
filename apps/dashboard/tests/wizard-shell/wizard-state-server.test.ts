/**
 * getWizardState() — server-side helper. Mocked StateStore.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getWizardState,
  ProjectNotFoundError,
} from '../../lib/wizard/state.server';

function fakeStore(row: { status: string; updatedAt: Date | string } | null) {
  return {
    loadProject: vi.fn(async () => row),
  } as unknown as Parameters<typeof getWizardState>[1]['store'];
}

describe('getWizardState', () => {
  it('returns snapshot with currentStepIndex set for an in-wizard state', async () => {
    const snap = await getWizardState('p-1', {
      store: fakeStore({
        status: 'information-architecture-in-progress',
        updatedAt: new Date('2026-05-25T10:00:00Z'),
      }),
    });
    expect(snap.state).toBe('information-architecture-in-progress');
    expect(snap.currentStepIndex).toBe(4);
    expect(snap.updatedAtIso).toBe('2026-05-25T10:00:00.000Z');
  });

  it('returns currentStepIndex=null for a post-wizard state', async () => {
    const snap = await getWizardState('p-2', {
      store: fakeStore({ status: 'done', updatedAt: new Date('2026-05-25T11:00:00Z') }),
    });
    expect(snap.currentStepIndex).toBeNull();
  });

  it('throws ProjectNotFoundError when the store returns null', async () => {
    await expect(
      getWizardState('p-missing', { store: fakeStore(null) }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('accepts an ISO string updatedAt as well as a Date', async () => {
    const snap = await getWizardState('p-3', {
      store: fakeStore({ status: 'interviewing', updatedAt: '2026-05-25T12:00:00.000Z' }),
    });
    expect(snap.updatedAtIso).toBe('2026-05-25T12:00:00.000Z');
  });
});
