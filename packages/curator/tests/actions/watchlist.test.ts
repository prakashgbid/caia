/**
 * Tests for the Curator Phase-2 industry-briefing watchlist loader.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultWatchlistPath,
  loadWatchlist
} from '../../src/actions/watchlist.js';

let tmp: string;
const fixedNow = (): Date => new Date('2026-05-05T22:50:00.000Z');

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'curator-watchlist-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('defaultWatchlistPath', () => {
  it('joins memoryDir + curator-watchlist.json', () => {
    expect(defaultWatchlistPath('/tmp/m')).toBe('/tmp/m/curator-watchlist.json');
  });
});

describe('loadWatchlist', () => {
  it('returns [] when the file does not exist', () => {
    expect(loadWatchlist({ memoryDir: tmp })).toEqual([]);
  });

  it('returns [] when the file is empty / whitespace', () => {
    writeFileSync(join(tmp, 'curator-watchlist.json'), '   \n');
    expect(loadWatchlist({ memoryDir: tmp })).toEqual([]);
  });

  it('returns [] when entries is missing or not an array', () => {
    writeFileSync(join(tmp, 'curator-watchlist.json'), '{"version":1}');
    expect(loadWatchlist({ memoryDir: tmp })).toEqual([]);
    writeFileSync(
      join(tmp, 'curator-watchlist.json'),
      '{"version":1,"entries":"not-an-array"}'
    );
    expect(loadWatchlist({ memoryDir: tmp })).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    writeFileSync(join(tmp, 'curator-watchlist.json'), '{ not: valid }');
    expect(() => loadWatchlist({ memoryDir: tmp })).toThrow();
  });

  it('throws when neither path nor memoryDir is provided', () => {
    expect(() => loadWatchlist({})).toThrow(/path.*memoryDir/);
  });

  it('converts a full entry to an IndustryBriefingAction', () => {
    const file = {
      version: 1,
      entries: [
        {
          topic: 'anthropic-claude-opus-4-6-release',
          title: 'Claude Opus 4.6 — what it would change for us',
          summary: 'Anthropic released Opus 4.6 today.',
          sourceUrl: 'https://anthropic.com/news/claude-4-6',
          evidence: ['benchmark-x improved 8%', 'reasoning-y improved 12%'],
          recommendation: 'Run our canonical eval suite against 4.6.'
        }
      ]
    };
    writeFileSync(join(tmp, 'curator-watchlist.json'), JSON.stringify(file));

    const out = loadWatchlist({ memoryDir: tmp, now: fixedNow });
    expect(out).toHaveLength(1);
    const a = out[0]!;
    expect(a.kind).toBe('industry-briefing');
    expect(a.topic).toBe('anthropic-claude-opus-4-6-release');
    expect(a.slug).toMatch(/^industry-briefing-anthropic-claude-opus-4-6-release/);
    expect(a.title).toBe('Claude Opus 4.6 — what it would change for us');
    expect(a.summary).toBe('Anthropic released Opus 4.6 today.');
    expect(a.evidence).toEqual([
      'benchmark-x improved 8%',
      'reasoning-y improved 12%'
    ]);
    expect(a.recommendation).toBe('Run our canonical eval suite against 4.6.');
    expect(a.sourceUrl).toBe('https://anthropic.com/news/claude-4-6');
    expect(a.detectedAt).toBe('2026-05-05T22:50:00.000Z');
    expect(a.sourceFindings).toEqual([]);
  });

  it('falls back to topic when title is missing', () => {
    writeFileSync(
      join(tmp, 'curator-watchlist.json'),
      JSON.stringify({ entries: [{ topic: 'mcp-spec-1-1' }] })
    );
    const out = loadWatchlist({ memoryDir: tmp, now: fixedNow });
    expect(out[0]!.title).toBe('mcp-spec-1-1');
  });

  it('falls back to TBD summary when missing', () => {
    writeFileSync(
      join(tmp, 'curator-watchlist.json'),
      JSON.stringify({ entries: [{ topic: 'x' }] })
    );
    const out = loadWatchlist({ memoryDir: tmp, now: fixedNow });
    expect(out[0]!.summary).toMatch(/TBD/);
  });

  it('falls back to a generic recommendation when missing', () => {
    writeFileSync(
      join(tmp, 'curator-watchlist.json'),
      JSON.stringify({ entries: [{ topic: 'x' }] })
    );
    const out = loadWatchlist({ memoryDir: tmp, now: fixedNow });
    expect(out[0]!.recommendation).toMatch(/Evaluate/);
  });

  it('omits sourceUrl when not provided', () => {
    writeFileSync(
      join(tmp, 'curator-watchlist.json'),
      JSON.stringify({ entries: [{ topic: 'x', title: 'Y' }] })
    );
    const out = loadWatchlist({ memoryDir: tmp, now: fixedNow });
    expect(out[0]!.sourceUrl).toBeUndefined();
  });

  it('handles multiple entries in order', () => {
    writeFileSync(
      join(tmp, 'curator-watchlist.json'),
      JSON.stringify({
        entries: [
          { topic: 'a', title: 'A' },
          { topic: 'b', title: 'B' },
          { topic: 'c', title: 'C' }
        ]
      })
    );
    const out = loadWatchlist({ memoryDir: tmp, now: fixedNow });
    expect(out.map((a) => a.topic)).toEqual(['a', 'b', 'c']);
  });

  it('explicit path option overrides memoryDir', () => {
    const customPath = join(tmp, 'custom-watchlist.json');
    writeFileSync(
      customPath,
      JSON.stringify({ entries: [{ topic: 'x' }] })
    );
    const out = loadWatchlist({ path: customPath, now: fixedNow });
    expect(out).toHaveLength(1);
    expect(out[0]!.topic).toBe('x');
  });

  it('truncates long topic slugs to 80 chars', () => {
    const longTopic = 'a'.repeat(200);
    writeFileSync(
      join(tmp, 'curator-watchlist.json'),
      JSON.stringify({ entries: [{ topic: longTopic }] })
    );
    const out = loadWatchlist({ memoryDir: tmp, now: fixedNow });
    expect(out[0]!.slug.length).toBeLessThanOrEqual(80);
  });
});
