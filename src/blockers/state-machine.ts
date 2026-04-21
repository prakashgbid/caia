import type { BlockerState } from './types';

export const BLOCKER_TRANSITIONS: Record<BlockerState, BlockerState[]> = {
  open:      ['resolved', 'cancelled'],
  resolved:  [],
  cancelled: [],
};

export function canBlockerTransition(from: BlockerState, to: BlockerState): boolean {
  return (BLOCKER_TRANSITIONS[from] ?? []).includes(to);
}

export function assertBlockerTransition(from: BlockerState, to: BlockerState): void {
  if (!canBlockerTransition(from, to)) {
    throw new Error(
      `Invalid blocker transition: ${from} → ${to}. Allowed from ${from}: [${(BLOCKER_TRANSITIONS[from] ?? []).join(', ')}]`,
    );
  }
}
