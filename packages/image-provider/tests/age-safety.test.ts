import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @xenova/transformers — must be hoisted before the module import
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
}));

// Mock @fal-ai/client
vi.mock('@fal-ai/client', () => ({
  fal: {
    subscribe: vi.fn(),
  },
}));

import { containsMinor } from '../src/validators/age-safety.js';
import { pipeline } from '@xenova/transformers';
import { fal } from '@fal-ai/client';

const mockPipeline = pipeline as unknown as ReturnType<typeof vi.fn>;
const mockFalSubscribe = (fal as unknown as { subscribe: ReturnType<typeof vi.fn> }).subscribe;

/** Returns a minimal valid image buffer (tiny JPEG SOI+EOI). */
function makeBuffer(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

/**
 * Setup the xenova mock so the classifier reports people with given confidence.
 * Confidence > 0.5 means the visual path proceeds to fal.ai.
 */
function mockXenovaWithPeople(confidence = 0.9): void {
  mockPipeline.mockResolvedValue(
    vi.fn().mockResolvedValue([{ label: 'person', score: confidence }]),
  );
}

/** Setup the xenova mock to report NO people (non-person label, low score). */
function mockXenovaNoPeople(): void {
  mockPipeline.mockResolvedValue(
    vi.fn().mockResolvedValue([{ label: 'casino table', score: 0.95 }]),
  );
}

/** Setup fal.ai mock to return a given answer word. */
function mockFalAnswer(answer: 'CLEAR' | 'MINOR' | 'UNCERTAIN'): void {
  mockFalSubscribe.mockResolvedValue({ output: answer });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('containsMinor — age-safety validator', () => {
  // ── Test 1: "children playing" in metadata ──────────────────────────────────
  it('rejects "children playing" in alt text immediately via metadata scan', async () => {
    const result = await containsMinor(makeBuffer(), { alt: 'children playing in park' });
    expect(result).toBe('contains-minor');
    // Metadata check fires before any visual check
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  // ── Test 2: "poker chips casino" → passes metadata, visual mock returns clear ─
  it('passes "poker chips casino" through metadata and returns clear when no people detected', async () => {
    mockXenovaNoPeople();
    const result = await containsMinor(makeBuffer(), { alt: 'poker chips casino table' });
    expect(result).toBe('clear');
  });

  // ── Test 3: "teen" in tags ──────────────────────────────────────────────────
  it('rejects "teen" found in tags array', async () => {
    const result = await containsMinor(makeBuffer(), {
      alt: 'person at casino',
      tags: ['casino', 'teen', 'gambling'],
    });
    expect(result).toBe('contains-minor');
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  // ── Test 4: "family reunion" without child indicators → passes, fal returns clear
  it('passes "family reunion" without nearby child indicators and returns clear from fal.ai', async () => {
    mockXenovaWithPeople(0.8);
    mockFalAnswer('CLEAR');
    const result = await containsMinor(makeBuffer(), { alt: 'family reunion at casino resort' });
    expect(result).toBe('clear');
  });

  // ── Test 5: "little girl" → immediate reject ────────────────────────────────
  it('rejects "little girl" in alt text immediately', async () => {
    const result = await containsMinor(makeBuffer(), { alt: 'little girl smiling' });
    expect(result).toBe('contains-minor');
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  // ── Test 6: "casino interior ambient" → clear (no people, no bad keywords) ──
  it('returns clear for "casino interior ambient" when no people are detected by classifier', async () => {
    mockXenovaNoPeople();
    const result = await containsMinor(makeBuffer(), { alt: 'casino interior ambient lighting' });
    expect(result).toBe('clear');
  });

  // ── Test 7: "junior player" in title ───────────────────────────────────────
  it('rejects "junior" found in title field', async () => {
    const result = await containsMinor(makeBuffer(), {
      title: 'junior player at tournament',
      alt: 'player at table',
    });
    expect(result).toBe('contains-minor');
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  // ── Test 8: "playground" with no age indicators → passes metadata ───────────
  it('passes "playground equipment" when no age indicators are near "playground"', async () => {
    mockXenovaNoPeople();
    // "playground" appears but no age indicator (boy/girl/kid/child etc.) is nearby
    const result = await containsMinor(makeBuffer(), {
      alt: 'playground equipment abstract photography',
    });
    expect(result).toBe('clear');
  });

  // ── Test 9: "school class photo" → immediate reject ────────────────────────
  it('rejects "school class photo" — school paired with class (age indicator)', async () => {
    const result = await containsMinor(makeBuffer(), { alt: 'school class photo' });
    expect(result).toBe('contains-minor');
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  // ── Test 10: "baby shower" → immediate reject ───────────────────────────────
  it('rejects "baby shower" found in description field', async () => {
    const result = await containsMinor(makeBuffer(), {
      description: 'decorations for a baby shower celebration',
    });
    expect(result).toBe('contains-minor');
    expect(mockPipeline).not.toHaveBeenCalled();
  });
});
