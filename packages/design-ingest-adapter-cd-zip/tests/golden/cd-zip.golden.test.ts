/**
 * Golden harness — SKELETON for the v0.1.0 scaffold.
 *
 * When the full pipeline lands, this test will:
 *   1. Resolve a fixture dir under tests/fixtures/.
 *   2. Invoke `CdZipAdapter.parse({ kind: 'upload', uploadId, tenantId })`.
 *   3. Diff the result against tests/golden/<fixture>.RenderableDesign.json
 *      with `uploadedAt` + `sourceMetadata.extractedAt` scrubbed.
 *   4. Assert empty diff.
 *
 * For v0.1.0, the harness asserts NotImplementedError fires — proving
 * the wiring + test runner are in place, and that a follow-up
 * implementation will be exercised by the same harness shape with one
 * line change (delete the `rejects.toThrow` and add the diff
 * assertion).
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { CdZipAdapter } from '../../src/index.js';
import { NotImplementedError } from '@caia/design-ingest';
import type { AdapterDeps, AdapterInput } from '@caia/design-ingest';

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'minimal',
);

const fakeDeps: AdapterDeps = {
  pg: {} as AdapterDeps['pg'],
  snapshotter: {} as AdapterDeps['snapshotter'],
  secrets: {} as AdapterDeps['secrets'],
  storage: {} as AdapterDeps['storage'],
  accessContext: {
    callerType: 'agent',
    callerId: 'golden-harness',
    reason: 'golden-fixture',
  },
};

const INPUT: AdapterInput = {
  kind: 'upload',
  uploadId: 'golden-minimal',
  tenantId: 't-golden',
};

describe('golden harness — minimal fixture', () => {
  it('fixture dir is present on disk', () => {
    expect(existsSync(FIXTURE_DIR)).toBe(true);
    expect(existsSync(resolve(FIXTURE_DIR, 'project/styles.css'))).toBe(true);
    expect(existsSync(resolve(FIXTURE_DIR, 'project/pages/home.jsx'))).toBe(true);
  });

  it('SCAFFOLD: parse throws NotImplementedError (replace when impl lands)', async () => {
    const adapter = new CdZipAdapter(fakeDeps);
    await expect(adapter.parse(INPUT)).rejects.toThrow(NotImplementedError);
  });
});
