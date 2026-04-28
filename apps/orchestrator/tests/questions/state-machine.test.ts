import {
  assertQuestionTransition,
  canQuestionTransition,
  QUESTION_TRANSITIONS,
} from '../../src/questions/state-machine';

describe('question state machine', () => {
  describe('QUESTION_TRANSITIONS', () => {
    it('open can transition to answered', () => {
      expect(canQuestionTransition('open', 'answered')).toBe(true);
    });

    it('open can transition to cancelled', () => {
      expect(canQuestionTransition('open', 'cancelled')).toBe(true);
    });

    it('answered has no outgoing transitions', () => {
      expect(QUESTION_TRANSITIONS.answered).toHaveLength(0);
    });

    it('cancelled has no outgoing transitions', () => {
      expect(QUESTION_TRANSITIONS.cancelled).toHaveLength(0);
    });

    it('answered cannot transition to open', () => {
      expect(canQuestionTransition('answered', 'open')).toBe(false);
    });

    it('cancelled cannot transition to answered', () => {
      expect(canQuestionTransition('cancelled', 'answered')).toBe(false);
    });

    it('answered cannot transition to cancelled', () => {
      expect(canQuestionTransition('answered', 'cancelled')).toBe(false);
    });

    it('open cannot stay in open', () => {
      expect(canQuestionTransition('open', 'open')).toBe(false);
    });
  });

  describe('assertQuestionTransition', () => {
    it('does not throw for valid open → answered', () => {
      expect(() => assertQuestionTransition('open', 'answered')).not.toThrow();
    });

    it('does not throw for valid open → cancelled', () => {
      expect(() => assertQuestionTransition('open', 'cancelled')).not.toThrow();
    });

    it('throws for invalid answered → open', () => {
      expect(() => assertQuestionTransition('answered', 'open')).toThrow(
        /Invalid question transition: answered → open/,
      );
    });

    it('throws for invalid cancelled → answered', () => {
      expect(() => assertQuestionTransition('cancelled', 'answered')).toThrow(
        /Invalid question transition/,
      );
    });

    it('error message lists allowed transitions', () => {
      expect(() => assertQuestionTransition('answered', 'open')).toThrow(/Allowed from answered:/);
    });
  });
});
