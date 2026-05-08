import { describe, expect, it } from 'vitest';

import { readCorpusManifest } from '../src/corpus-bridge.js';
import { InMemoryFs } from './helpers/fakes.js';

describe('readCorpusManifest', () => {
  it('returns null when manifest path does not exist', async () => {
    const fs = new InMemoryFs();
    expect(await readCorpusManifest({ manifestPath: '/nope', fs })).toBeNull();
  });

  it('parses outputDir, generatedAt, configSha256, holdout', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile(
      '/m.json',
      JSON.stringify({
        outputDir: '/out',
        generatedAt: '2026-05-06T00:00:00.000Z',
        configSha256: 'abc',
        holdout: ['x', 'y']
      })
    );
    const m = await readCorpusManifest({ manifestPath: '/m.json', fs });
    expect(m).toEqual({
      outputDir: '/out',
      generatedAt: '2026-05-06T00:00:00.000Z',
      configSha256: 'abc',
      holdout: ['x', 'y']
    });
  });

  it('tolerates absence of holdout (returns empty array)', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile('/m.json', JSON.stringify({ outputDir: '/o' }));
    const m = await readCorpusManifest({ manifestPath: '/m.json', fs });
    expect(m!.holdout).toEqual([]);
  });

  it('throws on non-JSON', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile('/m.json', 'not json');
    await expect(readCorpusManifest({ manifestPath: '/m.json', fs })).rejects.toThrow(
      /not valid JSON/
    );
  });

  it('throws on non-object', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile('/m.json', '"string"');
    await expect(readCorpusManifest({ manifestPath: '/m.json', fs })).rejects.toThrow(
      /not an object/
    );
  });

  it('drops non-string holdout entries', async () => {
    const fs = new InMemoryFs();
    await fs.writeFile('/m.json', JSON.stringify({ holdout: ['a', 42, null, 'b'] }));
    const m = await readCorpusManifest({ manifestPath: '/m.json', fs });
    expect(m!.holdout).toEqual(['a', 'b']);
  });
});
