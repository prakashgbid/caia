import { canTransition, assertTransition, VALID_TRANSITIONS } from '../../src/requirements/state-machine';
import type { RequirementState } from '../../src/requirements/types';

describe('RequirementStateMachine', () => {
  describe('canTransition', () => {
    it('allows captured → refining', () => {
      expect(canTransition('captured', 'refining')).toBe(true);
    });

    it('allows captured → cancelled', () => {
      expect(canTransition('captured', 'cancelled')).toBe(true);
    });

    it('allows refining → specced', () => {
      expect(canTransition('refining', 'specced')).toBe(true);
    });

    it('allows refining → captured (backtrack)', () => {
      expect(canTransition('refining', 'captured')).toBe(true);
    });

    it('allows specced → ready', () => {
      expect(canTransition('specced', 'ready')).toBe(true);
    });

    it('allows ready → executing', () => {
      expect(canTransition('ready', 'executing')).toBe(true);
    });

    it('allows ready → blocked', () => {
      expect(canTransition('ready', 'blocked')).toBe(true);
    });

    it('allows executing → verifying', () => {
      expect(canTransition('executing', 'verifying')).toBe(true);
    });

    it('allows executing → blocked', () => {
      expect(canTransition('executing', 'blocked')).toBe(true);
    });

    it('allows executing → ready (pause)', () => {
      expect(canTransition('executing', 'ready')).toBe(true);
    });

    it('allows verifying → done', () => {
      expect(canTransition('verifying', 'done')).toBe(true);
    });

    it('allows verifying → executing (retry)', () => {
      expect(canTransition('verifying', 'executing')).toBe(true);
    });

    it('allows blocked → ready', () => {
      expect(canTransition('blocked', 'ready')).toBe(true);
    });

    it('rejects done → anything', () => {
      const doneTargets: RequirementState[] = ['captured', 'refining', 'specced', 'ready', 'executing', 'verifying', 'blocked', 'cancelled'];
      for (const t of doneTargets) {
        expect(canTransition('done', t)).toBe(false);
      }
    });

    it('rejects cancelled → anything', () => {
      const cancelledTargets: RequirementState[] = ['captured', 'refining', 'specced', 'ready', 'executing', 'verifying', 'done', 'blocked'];
      for (const t of cancelledTargets) {
        expect(canTransition('cancelled', t)).toBe(false);
      }
    });

    it('rejects captured → executing directly', () => {
      expect(canTransition('captured', 'executing')).toBe(false);
    });

    it('rejects captured → done directly', () => {
      expect(canTransition('captured', 'done')).toBe(false);
    });

    it('rejects ready → verifying directly (must go through executing)', () => {
      expect(canTransition('ready', 'verifying')).toBe(false);
    });

    it('rejects blocked → done directly', () => {
      expect(canTransition('blocked', 'done')).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('does not throw for valid transition', () => {
      expect(() => assertTransition('captured', 'refining')).not.toThrow();
      expect(() => assertTransition('ready', 'executing')).not.toThrow();
      expect(() => assertTransition('verifying', 'done')).not.toThrow();
    });

    it('throws for invalid transition with descriptive message', () => {
      expect(() => assertTransition('done', 'ready')).toThrow(/done → ready/);
      expect(() => assertTransition('cancelled', 'captured')).toThrow(/cancelled → captured/);
      expect(() => assertTransition('captured', 'done')).toThrow(/captured → done/);
    });

    it('throws message including allowed transitions', () => {
      expect(() => assertTransition('captured', 'done')).toThrow(/refining/);
    });
  });

  describe('VALID_TRANSITIONS completeness', () => {
    it('every state has an entry', () => {
      const allStates: RequirementState[] = [
        'captured', 'refining', 'specced', 'ready',
        'executing', 'verifying', 'done', 'blocked', 'cancelled',
      ];
      for (const s of allStates) {
        expect(VALID_TRANSITIONS[s]).toBeDefined();
      }
    });

    it('terminal states have empty transition lists', () => {
      expect(VALID_TRANSITIONS['done']).toHaveLength(0);
      expect(VALID_TRANSITIONS['cancelled']).toHaveLength(0);
    });
  });

  describe('full happy-path journey', () => {
    it('captured → refining → specced → ready → executing → verifying → done', () => {
      const journey: RequirementState[] = ['captured', 'refining', 'specced', 'ready', 'executing', 'verifying', 'done'];
      for (let i = 0; i < journey.length - 1; i++) {
        expect(canTransition(journey[i]!, journey[i + 1]!)).toBe(true);
      }
    });
  });
});
