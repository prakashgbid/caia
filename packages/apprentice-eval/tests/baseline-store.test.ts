import { describe, expect, it } from 'vitest';

import { readBaseline, writeBaseline } from '../src/baseline-store.js';
import type { RubricResult } from '../src/types.js';
import { InMemoryFs } from './helpers/fakes.js';

const sample: RubricResult[] = [
  { promptId: 'p1', suiteId: 's', adapter: 'a', passed: 1, failed: 0, weightedScore: 0.9, assertions: [] },
  { promptId: 'p2', suiteId: 's', adapter: 'a', passed: 0, failed: 1, weightedScore: 0.2, assertions: [] }
];

describe('baseline-store', () => {
  it('returns null when baseline file does not exist', async () => {
    const fs = new InMemoryFs();
    const r = await readBaseline({ baselineRoot: '/b', adapter: 'a', fs });
    expect(r).toBeNull();
  });

  it('round-trips a snapshot via write + read', async () => {
    const fs = new InMemoryFs();
    const path = await writeBaseline({
      baselineRoot: '/b',
      adapter: 'a',
      results: sample,
      recordedAt: '2026-05-06T12:00:00.000Z',
      fs
    });
    expect(path).toBe('/b/a.json');
    const r = await readBaseline({ baselineRoot: '/b', adapter: 'a', fs });
    expect(r).not.toBeNull();
    expect(r!.adapter).toBe('a');
    expect(r!.entries).toHaveLength(2);
    expect(r!.entries[0]!.weightedScore).toBeCloseTo(0.9);
  });

  it('rejects malformed JSON', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile('/b/a.json', '{not json');
    await expect(readBaseline({ baselineRoot: '/b', adapter: 'a', fs })).rejects.toThrow(
      /not valid JSON/
    );
  });

  it('rejects unknown version', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile('/b/a.json', JSON.stringify({ version: 99, adapter: 'a', recordedAt: 'x', entries: [] }));
    await expect(readBaseline({ baselineRoot: '/b', adapter: 'a', fs })).rejects.toThrow(
      /unknown version 99/
    );
  });

  it('rejects malformed entries', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile(
      '/b/a.json',
      JSON.stringify({ version: 1, adapter: 'a', recordedAt: 'x', entries: [{ promptId: 'p' }] })
    );
    await expect(readBaseline({ baselineRoot: '/b', adapter: 'a', fs })).rejects.toThrow(/malformed/);
  });
});
