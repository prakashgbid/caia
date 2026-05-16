import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { inferPackages } from '../../src/pr/affected-packages.js';

async function fixture(layout: Record<string, { name: string }>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adopt-test-'));
  for (const [pkgDir, contents] of Object.entries(layout)) {
    const full = path.join(dir, 'packages', pkgDir);
    await fs.mkdir(full, { recursive: true });
    await fs.writeFile(
      path.join(full, 'package.json'),
      JSON.stringify({ name: contents.name }),
    );
  }
  return dir;
}

describe('inferPackages', () => {
  it('maps changed files to workspace package names', async () => {
    const dir = await fixture({
      'guardrails-validator': { name: '@chiefaia/guardrails-validator' },
      'orchestrator':         { name: '@chiefaia/orchestrator' },
    });

    const result = await inferPackages({
      worktreeDir: dir,
      pr: {
        number: 1,
        headRefName: 'adopt/guardrails-validator-abc1234',
        headRefOid: 'abc1234deadbeef',
        baseRefName: 'develop',
        url: '',
        title: 'chore(adopt): use @chiefaia/guardrails-validator in orchestrator',
        isDraft: false,
        mergeable: 'MERGEABLE',
        labels: [],
        files: [
          { path: 'packages/orchestrator/src/safety/bridge.ts' },
        ],
      },
    });

    expect(result.targetPackages).toContain('@chiefaia/guardrails-validator');
    expect(result.consumerPackages).toContain('@chiefaia/orchestrator');
  });

  it('falls back to branch when title lacks the target', async () => {
    const dir = await fixture({
      'tracing': { name: '@chiefaia/tracing' },
    });

    const result = await inferPackages({
      worktreeDir: dir,
      pr: {
        number: 2,
        headRefName: 'adopt/tracing-feed1234',
        headRefOid: 'feed1234',
        baseRefName: 'develop',
        url: '',
        title: 'chore(adopt): wire tracing across orchestrator',
        isDraft: false,
        mergeable: 'MERGEABLE',
        labels: [],
        files: [
          { path: 'packages/tracing/src/index.ts' },
        ],
      },
    });

    expect(result.targetPackages).toContain('@chiefaia/tracing');
  });
});
