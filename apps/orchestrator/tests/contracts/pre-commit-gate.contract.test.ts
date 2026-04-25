/**
 * Contract: SEC-052
 * Verifies: .env* file patterns are detected correctly (pure logic, no shell
 * execution). Tests the exact regex patterns that the pre-commit hook enforces.
 *
 * These tests are intentionally shell-free — they validate the pattern logic
 * that would be embedded in a pre-commit hook, making the invariant testable
 * in CI without requiring bash.
 */

describe('pre-commit gate patterns (SEC-052)', () => {
  /**
   * The pattern a pre-commit hook uses to catch staged .env* files.
   * Anchored at the start so it matches the filename portion of a path.
   */
  const ENV_FILE_PATTERN = /^\.env/;

  /**
   * The pattern used to catch autonomy-seeking phrases baked into committed
   * string literals (e.g. hard-coded prompts or test fixtures that contain
   * advisory phrasing).
   */
  const AUTONOMY_PHRASE_PATTERN = /should\s+i\b/i;

  describe('.env file detection pattern', () => {
    const shouldMatch = ['.env', '.env.local', '.env.production', '.env.development', '.env.test'];
    const shouldNotMatch = ['env.sh', 'environment.ts', 'dotenv.config.ts', 'myapp.env', 'README.env.md'];

    for (const filename of shouldMatch) {
      it(`should match "${filename}"`, () => {
        expect(ENV_FILE_PATTERN.test(filename)).toBe(true);
      });
    }

    for (const filename of shouldNotMatch) {
      it(`should NOT match "${filename}"`, () => {
        expect(ENV_FILE_PATTERN.test(filename)).toBe(false);
      });
    }
  });

  describe('autonomy phrase regex in string literals', () => {
    it('should catch the phrase "should I" in a string literal', () => {
      const literal = '"should I deploy this?"';
      expect(AUTONOMY_PHRASE_PATTERN.test(literal)).toBe(true);
    });

    it('should catch the phrase "Should I" (title case) in a string literal', () => {
      const literal = '"Should I restart the service?"';
      expect(AUTONOMY_PHRASE_PATTERN.test(literal)).toBe(true);
    });

    it('should catch the phrase "SHOULD I" (uppercase) in a string literal', () => {
      const literal = '"SHOULD I proceed?"';
      expect(AUTONOMY_PHRASE_PATTERN.test(literal)).toBe(true);
    });

    it('should not catch unrelated strings', () => {
      const clean = '"Decided: deploying now. Rationale: CI passed. In flight: rollout."';
      expect(AUTONOMY_PHRASE_PATTERN.test(clean)).toBe(false);
    });

    it('should catch "should i" embedded mid-sentence in a string literal', () => {
      const embedded = '"The agent asked: should i open a ticket?"';
      expect(AUTONOMY_PHRASE_PATTERN.test(embedded)).toBe(true);
    });
  });

  describe('combined gate logic', () => {
    /**
     * Simulates the gate check: a file is rejected if its basename matches the
     * .env pattern OR its content contains an autonomy phrase.
     */
    function gateCheck(filename: string, content: string): 'deny' | 'allow' {
      const basename = filename.split('/').pop() ?? filename;
      if (ENV_FILE_PATTERN.test(basename)) { return 'deny'; }
      if (AUTONOMY_PHRASE_PATTERN.test(content)) { return 'deny'; }
      return 'allow';
    }

    it('should deny a .env file regardless of content', () => {
      expect(gateCheck('.env.local', 'DB_URL=postgres://localhost/dev')).toBe('deny');
    });

    it('should deny a TypeScript file containing "should I"', () => {
      expect(gateCheck('src/prompts.ts', 'const prompt = "should I continue?"')).toBe('deny');
    });

    it('should allow a clean TypeScript file', () => {
      expect(gateCheck('src/service.ts', 'export function deploy() { return true; }')).toBe('allow');
    });

    it('should allow environment.ts (not an .env file)', () => {
      expect(gateCheck('src/environment.ts', 'export const ENV = process.env.NODE_ENV;')).toBe('allow');
    });
  });
});
