import type { RequirementState } from './types';

export const VALID_TRANSITIONS: Record<RequirementState, RequirementState[]> = {
  captured:  ['refining', 'cancelled'],
  refining:  ['specced', 'captured', 'cancelled'],
  specced:   ['ready', 'refining', 'cancelled'],
  ready:     ['executing', 'blocked', 'cancelled'],
  executing: ['verifying', 'blocked', 'ready', 'cancelled'],
  verifying: ['done', 'executing', 'blocked'],
  done:      [],
  blocked:   ['ready', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: RequirementState, to: RequirementState): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: RequirementState, to: RequirementState): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}. Allowed from ${from}: [${(VALID_TRANSITIONS[from] ?? []).join(', ')}]`,
    );
  }
}
