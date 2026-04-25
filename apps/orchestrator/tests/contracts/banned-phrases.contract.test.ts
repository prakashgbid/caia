/**
 * Contract: AUTON-001/002/006/007/008
 * Verifies: banned phrase patterns are detected and clean messages pass.
 *
 * These tests are intentionally interface-level — they test the public contract
 * of the banned-phrase scanner, not its internal implementation. If the API
 * changes, these tests should catch the break.
 */

import {
  scanForBannedPhrases,
  assertNoBannedPhrases,
  BANNED_PHRASE_PATTERNS,
} from '../../apps/orchestrator-middleware/src/banned-phrases';
import { BannedPhraseError } from '../../apps/orchestrator-middleware/src/errors';

describe('banned-phrases contract (AUTON-001/002/006/007/008)', () => {
  describe('scanForBannedPhrases — violation detection', () => {
    it('should detect "should I" phrase', () => {
      const result = scanForBannedPhrases('Should I proceed with the deployment?');
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.clean).toBe(false);
    });

    it('should detect "want me to" phrase', () => {
      const result = scanForBannedPhrases('Do you want me to refactor this module?');
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.clean).toBe(false);
    });

    it("should detect \"let me know if you'd like\" phrase", () => {
      const result = scanForBannedPhrases("Let me know if you'd like me to continue.");
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.clean).toBe(false);
    });

    it('should detect "please approve" phrase', () => {
      const result = scanForBannedPhrases('Please approve the schema migration before I run it.');
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.clean).toBe(false);
    });

    it('should detect "ready when you are" phrase', () => {
      const result = scanForBannedPhrases('The environment is configured. Ready when you are.');
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.clean).toBe(false);
    });

    it('should pass a clean decisive message without violations', () => {
      const result = scanForBannedPhrases(
        'Decided: using PostgreSQL for persistence. Rationale: existing stack alignment. In flight: running migration.',
      );
      expect(result.clean).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.rewriteSuggestion).toBeUndefined();
    });

    it('should attach a rewriteSuggestion when violations are found', () => {
      const result = scanForBannedPhrases('Should I start the build?');
      expect(result.rewriteSuggestion).toBeDefined();
      expect(result.rewriteSuggestion).toContain('Decided');
    });

    it('should not attach a rewriteSuggestion on a clean message', () => {
      const result = scanForBannedPhrases('Deploying to staging now.');
      expect(result.rewriteSuggestion).toBeUndefined();
    });

    it('should detect a banned phrase anywhere in the message, not just at the end', () => {
      const result = scanForBannedPhrases(
        'I have analysed the logs. Should I open a JIRA ticket? Moving on.',
      );
      expect(result.clean).toBe(false);
      const positions = result.violations.map(v => v.position);
      // The match should not be at position 0 — it is in the middle of the message
      expect(positions.some(p => p > 0)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const lower = scanForBannedPhrases('should i do this?');
      const upper = scanForBannedPhrases('SHOULD I DO THIS?');
      const mixed = scanForBannedPhrases('ShoUlD I do ThIs?');

      expect(lower.clean).toBe(false);
      expect(upper.clean).toBe(false);
      expect(mixed.clean).toBe(false);
    });

    it('violation result includes phrase label, position, and context fields', () => {
      const result = scanForBannedPhrases('Should I deploy now?');
      expect(result.violations.length).toBeGreaterThan(0);
      const v = result.violations[0]!;
      expect(typeof v.phrase).toBe('string');
      expect(typeof v.position).toBe('number');
      expect(typeof v.context).toBe('string');
      expect(v.position).toBeGreaterThanOrEqual(0);
    });
  });

  describe('assertNoBannedPhrases', () => {
    it('should throw BannedPhraseError when the message contains a violation', () => {
      expect(() => assertNoBannedPhrases('Should I restart the service?')).toThrow(
        BannedPhraseError,
      );
    });

    it('BannedPhraseError should carry the violations array', () => {
      let caught: BannedPhraseError | undefined;
      try {
        assertNoBannedPhrases('Should I restart the service?');
      } catch (err) {
        caught = err as BannedPhraseError;
      }
      expect(caught).toBeInstanceOf(BannedPhraseError);
      expect(caught!.violations.length).toBeGreaterThan(0);
    });

    it('should not throw on a clean decisive message', () => {
      expect(() =>
        assertNoBannedPhrases(
          'Decided: restarting the service. Rationale: memory leak detected. In flight: service restart.',
        ),
      ).not.toThrow();
    });
  });

  describe('BANNED_PHRASE_PATTERNS export', () => {
    it('should export an array of RegExp patterns', () => {
      expect(Array.isArray(BANNED_PHRASE_PATTERNS)).toBe(true);
      expect(BANNED_PHRASE_PATTERNS.length).toBeGreaterThan(0);
      for (const p of BANNED_PHRASE_PATTERNS) {
        expect(p).toBeInstanceOf(RegExp);
      }
    });

    it('every exported pattern should be case-insensitive', () => {
      for (const p of BANNED_PHRASE_PATTERNS) {
        expect(p.flags).toContain('i');
      }
    });
  });
});
