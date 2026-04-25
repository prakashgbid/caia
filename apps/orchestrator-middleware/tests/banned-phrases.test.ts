/**
 * Tests for the AUTON-001/002/006/007/008 banned-phrase scanner.
 */

import {
  scanForBannedPhrases,
  assertNoBannedPhrases,
  BANNED_PHRASE_PATTERNS,
} from '../src/banned-phrases.js';
import { BannedPhraseError } from '../src/errors.js';

describe('BANNED_PHRASE_PATTERNS', () => {
  it('exports an array of RegExp instances', () => {
    expect(Array.isArray(BANNED_PHRASE_PATTERNS)).toBe(true);
    expect(BANNED_PHRASE_PATTERNS.length).toBeGreaterThan(0);
    for (const p of BANNED_PHRASE_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});

describe('scanForBannedPhrases', () => {
  it('returns clean:true for a message with no banned phrases', () => {
    const result = scanForBannedPhrases('The build is complete. All tests pass.');
    expect(result.clean).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rewriteSuggestion).toBeUndefined();
  });

  it('detects "should I" case-insensitively', () => {
    const result = scanForBannedPhrases('Should I run the migration now?');
    expect(result.clean).toBe(false);
    expect(result.violations[0]?.phrase).toBe('should I');
  });

  it('detects "want me to"', () => {
    const result = scanForBannedPhrases('Do you want me to add retries?');
    expect(result.clean).toBe(false);
    expect(result.violations.some(v => v.phrase === 'want me to')).toBe(true);
  });

  it("detects \"let me know if you'd like\"", () => {
    const result = scanForBannedPhrases("Let me know if you'd like a summary.");
    expect(result.clean).toBe(false);
  });

  it('detects "please approve"', () => {
    const result = scanForBannedPhrases('Please approve this change.');
    expect(result.clean).toBe(false);
    expect(result.violations.some(v => v.phrase === 'please approve')).toBe(true);
  });

  it('detects "shall I"', () => {
    const result = scanForBannedPhrases('Shall I proceed?');
    expect(result.clean).toBe(false);
  });

  it('detects "ready when you are"', () => {
    const result = scanForBannedPhrases("Ready when you are — let's start.");
    expect(result.clean).toBe(false);
  });

  it('detects "confirm?" at end of question', () => {
    const result = scanForBannedPhrases('Can you confirm?');
    expect(result.clean).toBe(false);
  });

  it('detects "which would you prefer"', () => {
    const result = scanForBannedPhrases('Which would you prefer — JSON or YAML?');
    expect(result.clean).toBe(false);
  });

  it('detects "your call"', () => {
    const result = scanForBannedPhrases("It's your call whether we use Redis.");
    expect(result.clean).toBe(false);
  });

  it('includes position and non-empty context in each violation', () => {
    const msg = 'Should I run the migration?';
    const result = scanForBannedPhrases(msg);
    const v = result.violations[0]!;
    expect(typeof v.position).toBe('number');
    expect(v.position).toBeGreaterThanOrEqual(0);
    expect(v.context.length).toBeGreaterThan(0);
  });

  it('includes rewriteSuggestion when violations exist', () => {
    const result = scanForBannedPhrases('Shall I continue?');
    expect(result.rewriteSuggestion).toMatch(/Decided/);
  });

  it('finds multiple violations in one message', () => {
    const msg = 'Should I proceed? Let me know if you want changes.';
    const result = scanForBannedPhrases(msg);
    expect(result.violations.length).toBeGreaterThan(1);
  });
});

describe('assertNoBannedPhrases', () => {
  it('does not throw for a clean message', () => {
    expect(() => assertNoBannedPhrases('Deployment complete.')).not.toThrow();
  });

  it('throws BannedPhraseError with violations for a dirty message', () => {
    expect(() => assertNoBannedPhrases('Should I run tests?')).toThrow(BannedPhraseError);
  });

  it('BannedPhraseError carries the violations array', () => {
    let caught: BannedPhraseError | undefined;
    try {
      assertNoBannedPhrases('Shall I deploy?');
    } catch (e) {
      caught = e as BannedPhraseError;
    }
    expect(caught).toBeDefined();
    expect(caught!.violations.length).toBeGreaterThan(0);
    expect(caught!.name).toBe('BannedPhraseError');
  });
});
