import {
  assertBlockerTransition,
  BLOCKER_TRANSITIONS,
  canBlockerTransition,
} from '../../src/blockers/state-machine';

describe('blocker state machine', () => {
  describe('BLOCKER_TRANSITIONS', () => {
    it('open can transition to resolved', () => {
      expect(canBlockerTransition('open', 'resolved')).toBe(true);
    });

    it('open can transition to cancelled', () => {
      expect(canBlockerTransition('open', 'cancelled')).toBe(true);
    });

    it('resolved has no outgoing transitions', () => {
      expect(BLOCKER_TRANSITIONS.resolved).toHaveLength(0);
    });

    it('cancelled has no outgoing transitions', () => {
      expect(BLOCKER_TRANSITIONS.cancelled).toHaveLength(0);
    });

    it('resolved cannot transition to open', () => {
      expect(canBlockerTransition('resolved', 'open')).toBe(false);
    });

    it('cancelled cannot transition to open', () => {
      expect(canBlockerTransition('cancelled', 'open')).toBe(false);
    });

    it('cancelled cannot transition to resolved', () => {
      expect(canBlockerTransition('cancelled', 'resolved')).toBe(false);
    });

    it('resolved cannot transition to cancelled', () => {
      expect(canBlockerTransition('resolved', 'cancelled')).toBe(false);
    });

    it('open cannot stay in open via canTransition', () => {
      expect(canBlockerTransition('open', 'open')).toBe(false);
    });
  });

  describe('assertBlockerTransition', () => {
    it('does not throw for valid open → resolved', () => {
      expect(() => assertBlockerTransition('open', 'resolved')).not.toThrow();
    });

    it('does not throw for valid open → cancelled', () => {
      expect(() => assertBlockerTransition('open', 'cancelled')).not.toThrow();
    });

    it('throws for invalid resolved → open', () => {
      expect(() => assertBlockerTransition('resolved', 'open')).toThrow(
        /Invalid blocker transition: resolved → open/,
      );
    });

    it('throws for invalid cancelled → resolved', () => {
      expect(() => assertBlockerTransition('cancelled', 'resolved')).toThrow(
        /Invalid blocker transition/,
      );
    });

    it('error message lists allowed transitions', () => {
      expect(() => assertBlockerTransition('resolved', 'open')).toThrow(/Allowed from resolved:/);
    });
  });
});
