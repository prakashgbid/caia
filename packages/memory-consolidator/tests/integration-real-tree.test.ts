import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runConsolidation } from '../src/run.js';

/**
 * Integration test — runs the full pipeline against the operator's real
 * `~/Documents/projects/agent-memory` tree in DRY-RUN mode. Asserts:
 *  - the pipeline does not throw
 *  - at least 0 findings are returned (no positive assertion — a clean
 *    tree is a valid outcome)
 *  - reportPath is null (dryRun)
 *  - filesScanned > 0 (sanity check — the tree exists and has *.md files)
 *
 * Skipped if the corpus root does not exist (CI environments without
 * the operator's tree).
 */
const CORPUS = path.join(os.homedir(), 'Documents/projects/agent-memory');
const haveCorpus = fs.existsSync(CORPUS);

describe('integration — runConsolidation against real agent-memory tree', () => {
  it.skipIf(!haveCorpus)('does not throw and returns a sensible report', async () => {
    const r = await runConsolidation({ corpusRoot: CORPUS, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.reportPath).toBeNull();
    expect(r.filesScanned).toBeGreaterThan(0);
    expect(Array.isArray(r.findings)).toBe(true);
    expect(r.runAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('runs against an empty tmp dir with zero findings', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memcon-int-'));
    try {
      const r = await runConsolidation({ corpusRoot: tmp, dryRun: true });
      expect(r.filesScanned).toBe(0);
      expect(r.findings).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
