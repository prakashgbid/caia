import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { createReportsWalker } from '../src/reports-walker.js';
import { defaultFsReader } from '../src/fs-reader.js';

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'mini-reports');

describe('createReportsWalker', () => {
  it('reads markdown files in fixture reports dir', async () => {
    const walker = createReportsWalker({
      reportsRoot: FIXTURE_DIR,
      fs: defaultFsReader
    });
    const ctx = { maxAgeDays: 365 * 100, nowMs: Date.now() };
    const artifacts = await walker.read(ctx);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.kind).toBe('report');
    expect(artifacts[0]?.source).toBe('reports');
    expect(artifacts[0]?.text).toContain('Test handoff');
  });

  it('returns [] for missing root', async () => {
    const walker = createReportsWalker({
      reportsRoot: '/this/does/not/exist/fixture',
      fs: defaultFsReader
    });
    const ctx = { maxAgeDays: 365, nowMs: Date.now() };
    expect(await walker.read(ctx)).toEqual([]);
  });
});
