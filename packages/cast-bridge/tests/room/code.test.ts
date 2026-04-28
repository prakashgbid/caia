import { describe, it, expect } from 'vitest';
import { generateRoomCode } from '../../src/room/code';

// Ambiguous characters that must NEVER appear
const AMBIGUOUS = new Set(['O', '0', 'I', '1', 'L']);

describe('generateRoomCode', () => {
  // ── Test 1: Format ──────────────────────────────────────────
  describe('Format validation', () => {
    it('returns a string', () => {
      expect(typeof generateRoomCode()).toBe('string');
    });

    it('has exactly 9 characters', () => {
      expect(generateRoomCode()).toHaveLength(9);
    });

    it('contains exactly one hyphen', () => {
      const code = generateRoomCode();
      expect(code.split('-')).toHaveLength(2);
    });

    it('hyphen is at position 4 (index)', () => {
      expect(generateRoomCode()[4]).toBe('-');
    });

    it('first segment has exactly 4 characters', () => {
      expect(generateRoomCode().split('-')[0]).toHaveLength(4);
    });

    it('second segment has exactly 4 characters', () => {
      expect(generateRoomCode().split('-')[1]).toHaveLength(4);
    });

    it('matches pattern XXXX-XXXX', () => {
      expect(generateRoomCode()).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    });
  });

  // ── Test 2: No ambiguous characters ────────────────────────
  describe('No ambiguous characters', () => {
    it('never contains O (looks like 0)', () => {
      for (let i = 0; i < 500; i++) {
        expect(generateRoomCode()).not.toContain('O');
      }
    });

    it('never contains 0 (digit zero)', () => {
      for (let i = 0; i < 500; i++) {
        expect(generateRoomCode()).not.toContain('0');
      }
    });

    it('never contains I (looks like 1/l)', () => {
      for (let i = 0; i < 500; i++) {
        expect(generateRoomCode()).not.toContain('I');
      }
    });

    it('never contains 1 (digit one)', () => {
      for (let i = 0; i < 500; i++) {
        expect(generateRoomCode()).not.toContain('1');
      }
    });

    it('never contains L (looks like 1/I)', () => {
      for (let i = 0; i < 500; i++) {
        expect(generateRoomCode()).not.toContain('L');
      }
    });

    it('no digit characters at all', () => {
      for (let i = 0; i < 200; i++) {
        const code = generateRoomCode();
        const letters = code.replace('-', '');
        expect(letters).toMatch(/^[A-Z]+$/);
      }
    });
  });

  // ── Test 3: All uppercase ───────────────────────────────────
  describe('All uppercase letters', () => {
    it('all characters are uppercase (A-Z) or hyphen', () => {
      for (let i = 0; i < 200; i++) {
        const code = generateRoomCode();
        expect(code).toMatch(/^[A-Z-]+$/);
      }
    });

    it('no lowercase letters', () => {
      for (let i = 0; i < 200; i++) {
        expect(generateRoomCode()).toMatch(/^[^a-z]+$/);
      }
    });
  });

  // ── Test 4: Uniqueness — 10,000 generations ─────────────────
  describe('Uniqueness', () => {
    it('10,000 generated codes are all unique', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        codes.add(generateRoomCode());
      }
      // With 22^8 ≈ 54 billion combos, collisions in 10k are essentially impossible
      expect(codes.size).toBe(10_000);
    });
  });

  // ── Test 5: Specific length always exactly 9 ───────────────
  describe('Length invariant', () => {
    it('100 codes all have length exactly 9', () => {
      for (let i = 0; i < 100; i++) {
        expect(generateRoomCode()).toHaveLength(9);
      }
    });
  });

  // ── Test 6: Only A-Z and hyphen ────────────────────────────
  describe('Character set', () => {
    it('only contains allowed characters [A-Z] and hyphen', () => {
      const allowed = /^[A-HJ-KM-NP-Z-]+$/; // Excludes I, L, O
      for (let i = 0; i < 500; i++) {
        expect(generateRoomCode()).toMatch(allowed);
      }
    });

    it('never contains characters from AMBIGUOUS set', () => {
      for (let i = 0; i < 1000; i++) {
        const code = generateRoomCode();
        for (const ch of code) {
          if (ch !== '-') {
            expect(AMBIGUOUS.has(ch)).toBe(false);
          }
        }
      }
    });
  });

  // ── Test 7: Split parts ─────────────────────────────────────
  describe('Split segments', () => {
    it('splitting by hyphen gives exactly 2 parts', () => {
      for (let i = 0; i < 100; i++) {
        const parts = generateRoomCode().split('-');
        expect(parts).toHaveLength(2);
      }
    });

    it('both parts are truthy non-empty strings', () => {
      for (let i = 0; i < 100; i++) {
        const [a, b] = generateRoomCode().split('-');
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
      }
    });
  });

  // ── Test 8: Statistical character distribution ──────────────
  describe('Character distribution (statistical)', () => {
    it('alphabet uses 23 distinct characters (A-Z minus O, I, L)', () => {
      const EXPECTED_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
      expect(EXPECTED_ALPHABET).toHaveLength(23);

      const allChars = new Set<string>();
      for (let i = 0; i < 5000; i++) {
        for (const ch of generateRoomCode().replace('-', '')) {
          allChars.add(ch);
        }
      }
      // All characters used should be from the 22-char set
      for (const ch of allChars) {
        expect(EXPECTED_ALPHABET).toContain(ch);
      }
    });
  });
});
