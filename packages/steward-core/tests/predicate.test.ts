import { describe, expect, it } from 'vitest';
import { evaluatePredicate, PredicateError } from '../src/predicate.js';

describe('predicate evaluator', () => {
  describe('literal comparisons', () => {
    it('evaluates string equality', () => {
      expect(evaluatePredicate('"a" == "a"', {})).toBe(true);
      expect(evaluatePredicate('"a" == "b"', {})).toBe(false);
    });

    it('evaluates number equality', () => {
      expect(evaluatePredicate('42 == 42', {})).toBe(true);
      expect(evaluatePredicate('42 == 43', {})).toBe(false);
    });

    it('evaluates inequality', () => {
      expect(evaluatePredicate('"a" != "b"', {})).toBe(true);
      expect(evaluatePredicate('"a" != "a"', {})).toBe(false);
    });

    it('evaluates numeric ordering', () => {
      expect(evaluatePredicate('5 > 3', {})).toBe(true);
      expect(evaluatePredicate('5 < 3', {})).toBe(false);
      expect(evaluatePredicate('5 >= 5', {})).toBe(true);
      expect(evaluatePredicate('5 <= 4', {})).toBe(false);
    });
  });

  describe('logical operators', () => {
    it('evaluates AND with short-circuit-like behaviour', () => {
      expect(evaluatePredicate('true && true', {})).toBe(true);
      expect(evaluatePredicate('true && false', {})).toBe(false);
      expect(evaluatePredicate('false && true', {})).toBe(false);
    });

    it('evaluates OR', () => {
      expect(evaluatePredicate('true || false', {})).toBe(true);
      expect(evaluatePredicate('false || false', {})).toBe(false);
    });

    it('evaluates NOT', () => {
      expect(evaluatePredicate('!true', {})).toBe(false);
      expect(evaluatePredicate('!false', {})).toBe(true);
    });

    it('respects parenthesisation', () => {
      expect(evaluatePredicate('(true || false) && false', {})).toBe(false);
      expect(evaluatePredicate('true || (false && false)', {})).toBe(true);
    });
  });

  describe('regex match (=~)', () => {
    it('matches simple anchored patterns', () => {
      expect(evaluatePredicate('"release/2026-05-02" =~ "^release/"', {})).toBe(true);
      expect(evaluatePredicate('"feature/foo" =~ "^release/"', {})).toBe(false);
    });

    it('returns false for non-string lhs/rhs', () => {
      expect(evaluatePredicate('5 =~ "[0-9]"', {})).toBe(false);
    });

    it('returns false for invalid regex', () => {
      expect(evaluatePredicate('"x" =~ "[unterminated"', {})).toBe(false);
    });
  });

  describe('jsonpath accessors', () => {
    it('reads top-level identifiers from context', () => {
      expect(evaluatePredicate('foo == 1', { foo: 1 })).toBe(true);
    });

    it('reads dotted paths', () => {
      const ctx = {
        event: {
          payload: { pull_request: { base: { ref: 'main' } } },
        },
      };
      expect(evaluatePredicate('event.payload.pull_request.base.ref == "main"', ctx)).toBe(true);
    });

    it('returns undefined for missing paths and compares accordingly', () => {
      expect(evaluatePredicate('event.missing.field == "x"', { event: {} })).toBe(false);
      expect(evaluatePredicate('event.missing.field != "x"', { event: {} })).toBe(true);
    });
  });

  describe('the back-merge predicate (the rule that ships)', () => {
    const expr =
      'event.type == "github.pull_request.merged" && event.payload.base_ref == "main" && event.payload.head_ref =~ "^release/"';

    it('matches a release-landed event', () => {
      const ctx = {
        event: {
          type: 'github.pull_request.merged',
          payload: { base_ref: 'main', head_ref: 'release/2026-05-02-cleanup' },
        },
      };
      expect(evaluatePredicate(expr, ctx)).toBe(true);
    });

    it('does not match a non-release merge to main', () => {
      const ctx = {
        event: {
          type: 'github.pull_request.merged',
          payload: { base_ref: 'main', head_ref: 'feature/something' },
        },
      };
      expect(evaluatePredicate(expr, ctx)).toBe(false);
    });

    it('does not match an open (non-merged) release PR', () => {
      const ctx = {
        event: {
          type: 'github.pull_request.opened',
          payload: { base_ref: 'main', head_ref: 'release/2026-05-02-cleanup' },
        },
      };
      expect(evaluatePredicate(expr, ctx)).toBe(false);
    });

    it('does not match a back-merge merge into develop', () => {
      const ctx = {
        event: {
          type: 'github.pull_request.merged',
          payload: { base_ref: 'develop', head_ref: 'main' },
        },
      };
      expect(evaluatePredicate(expr, ctx)).toBe(false);
    });
  });

  describe('error cases', () => {
    it('throws on unterminated string', () => {
      expect(() => evaluatePredicate('"foo', {})).toThrow(PredicateError);
    });

    it('throws on unbalanced parentheses', () => {
      expect(() => evaluatePredicate('(true', {})).toThrow(PredicateError);
    });

    it('throws on unexpected character', () => {
      expect(() => evaluatePredicate('a # b', {})).toThrow(PredicateError);
    });

    it('throws on dangling operator', () => {
      expect(() => evaluatePredicate('true &&', {})).toThrow(PredicateError);
    });
  });
});
